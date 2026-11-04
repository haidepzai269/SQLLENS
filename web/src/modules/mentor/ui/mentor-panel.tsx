"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/contracts/api-error";
import type { EvidenceLabel } from "@/contracts/conclusion";
import type { EngineAdapter, TryChangeResult } from "@/contracts/engine";
import type { EvidencePack, MentorRequest } from "@/contracts/mentor";
import type { Plan, PlanNode } from "@/contracts/plan";
import { useAuth } from "@/modules/auth/auth-provider";
import { LoginDialog } from "@/modules/auth/login-dialog";
import { takeSql } from "@/modules/auth/sql-stash";
import { WhatIfCompare } from "@/modules/what-if/compare-ui/what-if-compare";
import { checkAnswer } from "../evidence";
import { verifyAnswer, type VerifiedAnswer } from "../verify";
import { splitAnswer } from "../verify/split";
import { readEvents } from "./stream";

export const MAX_QUESTION = 2000;
const MAX_ANSWER_CHARS = 40_000; // Gin cắt ở 32 KiB; quá mức này là server sai, không hiển thị tiếp
// Chỉ các khóa này có trong messages/*/error.json; khóa lạ từ server quy về "internal".
const ERROR_KEYS = new Set([
  "badRequest", "payloadTooLarge", "authRequired", "quotaExceeded", "quotaUnavailable", "notConfigured",
  "rateLimited", "aiUnavailable", "aiTooLong", "internal",
]);
const errKey = (raw: string) => {
  const k = raw.replace(/^error\./, "");
  return ERROR_KEYS.has(k) ? k : "internal";
};

type Adapter = Pick<EngineAdapter, "engine" | "explain" | "tryChange" | "cancel" | "rebuild">;
type Kind = "auth" | "limit" | "unavailable" | "badRequest" | "network" | "interrupted" | "stream" | "tooLong";
type Fail = { kind: Kind; key?: string; waitSeconds?: number };
type Phase = "sending" | "streaming" | "verifying" | "done" | "stopped" | "failed";
type Check = { unknownNumbers: string[]; bannedClaims: string[] };
type Turn = {
  id: number;
  question: string;
  text: string;
  phase: Phase;
  fail?: Fail;
  verified?: VerifiedAnswer;
  verifyFailed?: boolean;
  check?: Check;
  rebuildFailed?: boolean;
};
type Applied = { n: number; change?: string; probe: string };
type Tr = (key: string, values?: Record<string, string | number>) => string;

const BUSY = new Set<Phase>(["sending", "streaming", "verifying"]);
const len = (s: string) => Array.from(s).length;
const sumPages = (n: PlanNode): number => (n.pagesRead ?? 0) + n.children.reduce((a, c) => a + sumPages(c), 0);
const blocks = (s: { sharedHitBlocks: number; sharedReadBlocks: number }) => s.sharedHitBlocks + s.sharedReadBlocks;

// Lỗi trước khi stream: JSON của Gin + header Retry-After.
async function failureOf(res: Response): Promise<Fail> {
  let key = "internal";
  try {
    const b: unknown = await res.json();
    if (isApiError(b)) key = errKey(b.error.messageKey);
  } catch {
    /* thân không phải JSON */
  }
  const retry = Number(res.headers.get("Retry-After"));
  const waitSeconds = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined;
  if (res.status === 401) return { kind: "auth", key };
  if (res.status === 429) return { kind: "limit", key, waitSeconds };
  if (res.status === 400 || res.status === 413) return { kind: "badRequest", key };
  return { kind: "unavailable", key, waitSeconds };
}

export function MentorPanel({ adapter, evidence, probe }: { adapter: Adapter; evidence: EvidencePack; probe?: string }) {
  const t = useTranslations("mentor");
  const tr = useTranslations() as unknown as Tr; // khóa mentorVerify.* do verifyAnswer trả về
  const locale = useLocale() === "en" ? "en" : "vi";
  const { status, markAnon, sqlRef } = useAuth();
  const [question, setQuestion] = useState("");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const adapterRef = useRef(adapter);
  const verifying = useRef(false); // đọc đồng bộ, không phụ thuộc lần render (tránh dừng đúng lúc chuyển pha)
  useEffect(() => {
    adapterRef.current = adapter;
  });

  // Để hộp thoại đăng nhập lưu tạm đúng câu đang gõ; quay về thì trả lại (theo cách Task044).
  useEffect(() => {
    sqlRef.current = question;
  }, [question, sqlRef]);
  useEffect(() => {
    const saved = takeSql();
    if (saved) setQuestion((cur) => (cur === "" ? saved : cur)); // eslint-disable-line react-hooks/set-state-in-effect -- đọc sessionStorage một lần sau mount
  }, []);

  const patch = useCallback((id: number, p: Partial<Turn>) => setTurn((cur) => (cur && cur.id === id ? { ...cur, ...p } : cur)), []);

  // Hủy yêu cầu và cả bước chạy thử: câu đang chạy trong worker chỉ dừng bằng cancel rồi rebuild.
  const abortTurn = useCallback(async () => {
    ctl.current?.abort();
    ctl.current = null;
    if (!verifying.current) return true;
    verifying.current = false;
    try {
      await adapterRef.current.cancel();
      await adapterRef.current.rebuild();
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(
    () => () => {
      void abortTurn();
    },
    [abortTurn],
  );

  async function send() {
    const q = question.trim();
    if (!q || len(q) > MAX_QUESTION) return;
    if (status === "anon") return setLoginOpen(true);
    const id = ++seq.current; // câu cũ trả về muộn không được ghi đè câu mới
    setApplied(null);
    setTurn({ id, question: q, text: "", phase: "sending" });
    const rebuilt = abortTurn();
    const ac = new AbortController();
    ctl.current = ac;
    let text = "";
    let started = false;
    const fail = (f: Fail) => patch(id, { phase: "failed", fail: f });
    try {
      if (!(await rebuilt)) patch(id, { rebuildFailed: true });
      if (ac.signal.aborted) return;
      const req: MentorRequest = { question: q, evidence, locale };
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
      if (!res.ok) {
        const f = await failureOf(res);
        if (f.kind === "auth") {
          markAnon();
          setLoginOpen(true);
        }
        return fail(f);
      }
      if (!res.body) return fail({ kind: "interrupted" });
      patch(id, { phase: "streaming" });
      started = true;
      let finished = false;
      for await (const ev of readEvents(res.body)) {
        if (ev.type === "delta") {
          text += ev.text;
          if (text.length > MAX_ANSWER_CHARS) {
            ac.abort();
            patch(id, { text, check: checkAnswer(text, evidence) });
            return fail({ kind: "tooLong", key: "aiTooLong" });
          }
          patch(id, { text });
        } else if (ev.type === "error") {
          const key = errKey(ev.messageKey);
          patch(id, { check: checkAnswer(text, evidence) });
          return fail({ kind: key === "aiTooLong" ? "tooLong" : "stream", key });
        } else {
          finished = true;
          break;
        }
      }
      if (!finished) {
        patch(id, { check: checkAnswer(text, evidence) });
        return fail({ kind: "interrupted" });
      }
      patch(id, { phase: "verifying", check: checkAnswer(text, evidence) });
      verifying.current = true;
      try {
        const verified = await verifyAnswer(adapterRef.current, text, { probe, signal: ac.signal });
        if (ac.signal.aborted) return; // đã dừng hoặc bị câu mới thay: không ghi đè
        verifying.current = false;
        patch(id, { phase: "done", verified });
      } catch {
        if (ac.signal.aborted) return;
        verifying.current = false;
        patch(id, { phase: "done", verifyFailed: true });
      }
    } catch {
      if (ac.signal.aborted) return; // người dùng dừng hoặc câu mới thay thế: đã xử lý ở nơi hủy
      if (started) patch(id, { check: checkAnswer(text, evidence) });
      fail({ kind: started ? "interrupted" : "network" });
    }
  }

  async function stop() {
    if (!turn || !BUSY.has(turn.phase)) return;
    patch(turn.id, { phase: "stopped", check: turn.check ?? (turn.text ? checkAnswer(turn.text, evidence) : undefined) });
    if (!(await abortTurn())) patch(turn.id, { rebuildFailed: true });
  }

  const busy = turn !== null && BUSY.has(turn.phase);
  const over = len(question) > MAX_QUESTION;
  const incomplete = turn !== null && (turn.phase === "stopped" || turn.phase === "failed");

  return (
    <section aria-label={t("region")} className="flex min-w-0 flex-col gap-3" data-testid="mentor">
      <p role="note" className="m-0 text-xs text-ink2" data-testid="mentor-disclaimer">{t("disclaimer")}</p>
      <div
        className="flex min-w-0 flex-col gap-2"
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      >
        <label htmlFor="mentor-question" className="text-sm font-semibold">{t("questionLabel")}</label>
        <Textarea
          id="mentor-question"
          data-testid="mentor-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("questionPlaceholder")}
          aria-invalid={over}
          aria-describedby="mentor-count"
          className="max-h-48 min-h-20"
        />
        <p id="mentor-count" className={`m-0 text-xs ${over ? "text-destructive" : "text-dim"}`} data-testid="mentor-count">
          {over ? t("tooLong", { count: len(question), max: MAX_QUESTION }) : t("count", { count: len(question), max: MAX_QUESTION })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void send()} disabled={!question.trim() || over} data-testid="mentor-send">{t("send")}</Button>
          {busy && <Button variant="outline" onClick={() => void stop()} data-testid="mentor-stop">{t("stop")}</Button>}
          <span className="text-xs text-dim">{t("shortcut")}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {!turn && <p className="m-0 text-sm text-dim" data-testid="mentor-empty">{t("empty")}</p>}
        {turn && (
          <div className="flex min-w-0 flex-col gap-3" data-testid="mentor-turn" data-phase={turn.phase}>
            <div className="min-w-0">
              <p className="m-0 text-xs text-dim">{t("asked")}</p>
              <p className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm" data-testid="mentor-asked">{turn.question}</p>
            </div>
            <p role="status" className="m-0 text-xs text-dim" data-testid="mentor-status">
              {BUSY.has(turn.phase) ? t(`phase.${turn.phase}`) : ""}
            </p>
            {turn.fail && <FailView fail={turn.fail} onLogin={() => setLoginOpen(true)} />}
            {turn.phase === "stopped" && (
              <Alert data-testid="mentor-stopped"><AlertDescription>{t("stopped")}</AlertDescription></Alert>
            )}
            {turn.rebuildFailed && (
              <Alert variant="destructive" data-testid="mentor-rebuild-failed"><AlertDescription>{t("rebuildFailed")}</AlertDescription></Alert>
            )}
            {incomplete && turn.text && (
              <Alert data-testid="mentor-incomplete"><AlertDescription>{t("incomplete")}</AlertDescription></Alert>
            )}
            {turn.check && turn.check.unknownNumbers.length > 0 && (
              <Alert variant="destructive" data-testid="mentor-unknown-numbers">
                <AlertTitle>{t("warn.unknownTitle")}</AlertTitle>
                <AlertDescription>{t("warn.unknownBody", { numbers: turn.check.unknownNumbers.join(", ") })}</AlertDescription>
              </Alert>
            )}
            {turn.check && turn.check.bannedClaims.length > 0 && (
              <Alert variant="destructive" data-testid="mentor-banned">
                <AlertTitle>{t("warn.bannedTitle")}</AlertTitle>
                <AlertDescription>
                  {t("warn.bannedBody")}{" "}
                  {turn.check.bannedClaims.map((c, i) => (
                    <q key={i} className="mr-1">{c}</q>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {(turn.text || turn.phase === "done") && (
              <div className="flex min-w-0 flex-col gap-2" data-testid="mentor-answer" role="region" aria-live="polite" aria-busy={busy} aria-label={t("answerLabel")}>
                <span className="w-fit rounded-[2px] border border-line px-[7px] text-xs text-ink2" data-testid="mentor-ai-tag">{t("aiTag")}</span>
                {turn.phase === "done" && !turn.text.trim() && <p className="m-0 text-sm text-dim" data-testid="mentor-empty-answer">{t("emptyAnswer")}</p>}
                <Parts turn={turn} tr={tr} probe={probe} onApply={(a) => setApplied(a)} />
                {turn.verified && turn.verified.hiddenCount > 0 && (
                  <p className="m-0 text-xs text-dim" data-testid="mentor-hidden-count">{t("hiddenCount", { count: turn.verified.hiddenCount })}</p>
                )}
              </div>
            )}
          </div>
        )}
        {applied && (
          <section aria-label={t("applyRegion")} className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" data-testid="mentor-applied">
            <h3 className="m-0 text-sm font-semibold">{t("applyRegion")}</h3>
            <p className="m-0 text-xs text-ink2">{t("applyHint")}</p>
            <WhatIfCompare key={applied.n} adapter={adapter} probe={applied.probe} initialChange={applied.change} />
          </section>
        )}
      </div>
      <LoginDialog open={loginOpen} reason="ai" onClose={() => setLoginOpen(false)} />
    </section>
  );
}

function FailView({ fail, onLogin }: { fail: Fail; onLogin: () => void }) {
  const t = useTranslations("mentor");
  const te = useTranslations("error");
  return (
    <Alert variant="destructive" data-testid="mentor-error" data-kind={fail.kind}>
      <AlertTitle>{t(`err.${fail.kind}`)}</AlertTitle>
      <AlertDescription>
        {fail.key && fail.kind !== "interrupted" && <span>{te(fail.key)} </span>}
        {fail.waitSeconds !== undefined && <span data-testid="mentor-retry">{t("retryAfter", { seconds: fail.waitSeconds })} </span>}
        {fail.kind === "auth" && (
          <Button size="sm" variant="outline" onClick={onLogin} data-testid="mentor-login">{t("signIn")}</Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

const LABEL_CLS: Record<EvidenceLabel, string> = {
  real: "bg-label-real text-label-real-foreground",
  simulated: "border border-label-simulated text-white",
  estimated: "border border-dashed border-label-estimated italic text-white",
};

// Nội dung AI luôn là text node: không dangerouslySetInnerHTML, không Markdown, không thẻ a.
function Parts({ turn, tr, probe, onApply }: { turn: Turn; tr: Tr; probe?: string; onApply: (a: Applied) => void }) {
  const t = useTranslations("mentor");
  const counter = useRef(0);
  const waiting = BUSY.has(turn.phase);
  const parts = turn.verified?.parts ?? splitAnswer(turn.text).map((p) => (p.kind === "text" ? p : ({ kind: "pending" } as const)));
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") {
          return p.text.trim() ? (
            <p key={i} className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm" data-testid="mentor-text">{p.text}</p>
          ) : null;
        }
        if (p.kind === "hidden") {
          return <p key={i} className="m-0 text-xs text-ink2" data-testid="mentor-sql-hidden">{tr(p.reasonKey)}</p>;
        }
        if (p.kind === "pending") {
          return (
            <p key={i} className="m-0 text-xs text-dim" data-testid="mentor-sql-pending">
              {waiting ? t("sqlPending") : turn.verifyFailed ? t("verifyFailed") : t("sqlUnchecked")}
            </p>
          );
        }
        const { outcome } = p;
        const isPlan = "root" in outcome.data;
        let pages: string | null = null;
        if (isPlan) {
          const plan = outcome.data as Plan;
          if (plan.analyzed) pages = t("pages", { pages: sumPages(plan.root) });
        } else {
          const r = outcome.data as TryChangeResult;
          pages = t("pagesChange", { before: blocks(r.before), after: blocks(r.after) });
        }
        const applyProbe = isPlan ? p.sql : probe;
        return (
          <div key={i} className="flex min-w-0 flex-col gap-1 border border-line p-2" data-testid="mentor-sql-ok">
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="mentor-label" data-label={outcome.label} className={`inline-flex h-5 items-center rounded-[2px] px-[7px] text-xs ${LABEL_CLS[outcome.label]}`}>
                {t(`label.${outcome.label}`)}
              </span>
              <span className="text-xs text-ink2">{t("ranHere")}</span>
            </div>
            <pre className="m-0 max-w-full overflow-x-auto text-sm"><code className="font-mono">{p.sql}</code></pre>
            {pages && <p className="m-0 text-xs text-ink2" data-testid="mentor-pages">{pages}</p>}
            {applyProbe && (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                data-testid="mentor-apply"
                onClick={() => onApply({ n: ++counter.current, probe: applyProbe, change: isPlan ? undefined : p.sql })}
              >
                {t("apply")}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
