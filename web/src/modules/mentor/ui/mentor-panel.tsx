"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/contracts/api-error";
import type { EngineAdapter } from "@/contracts/engine";
import type { EvidencePack, MentorRequest } from "@/contracts/mentor";
import { PlanEvidencePill, PLAN_EVIDENCE_STORAGE_KEY } from "@/components/mentor/plan-evidence-pill";
import { QuickActionChips } from "@/components/mentor/quick-action-chips";
import { canRunExplain } from "@/engines/mysql/guard";
import { minifyPlanJson } from "@/modules/plan-runner/minifier/plan-minifier";
import { useAuth } from "@/modules/auth/auth-provider";
import { LoginDialog } from "@/modules/auth/login-dialog";
import { takeSql } from "@/modules/auth/sql-stash";
import { WhatIfCompare } from "@/modules/what-if/compare-ui/what-if-compare";
import { sendMentorChat } from "../api/chat";
import { checkAnswer } from "../evidence";
import { verifyAnswer } from "../verify";
import {
  BUSY,
  buildContextSummary,
  ConversationThread,
  type Applied,
  type Fail,
  type Tr,
  type Turn,
} from "./conversation-thread";
import { readEvents } from "./stream";

export const MAX_QUESTION = 2000;
export const MAX_TURNS = 5;
const MAX_ANSWER_CHARS = 40_000; // Gin cắt ở 32 KiB; quá mức này là server sai, không hiển thị tiếp

// Chỉ các khóa này có trong messages/*/error.json; khóa lạ từ server quy về "internal".
const ERROR_KEYS = new Set([
  "badRequest", "nonDatabaseQuestion", "payloadTooLarge", "authRequired", "quotaExceeded", "quotaUnavailable", "notConfigured",
  "rateLimited", "aiUnavailable", "aiTooLong", "internal",
]);
const errKey = (raw: string) => {
  const k = raw.replace(/^error\./, "");
  return ERROR_KEYS.has(k) ? k : "internal";
};

type Adapter = Pick<EngineAdapter, "engine" | "explain" | "tryChange" | "cancel" | "rebuild">;

const len = (s: string) => Array.from(s).length;

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

export interface MentorPanelProps {
  adapter: Adapter;
  evidence: EvidencePack;
  probe?: string;
  planEvidence?: string | null;
  isMeasuring?: boolean;
}

export function MentorPanel({ adapter, evidence, probe, planEvidence, isMeasuring }: MentorPanelProps) {
  const t = useTranslations("mentor");
  const tr = useTranslations() as unknown as Tr; // khóa mentorVerify.* do verifyAnswer trả về
  const locale = useLocale() === "en" ? "en" : "vi";
  const { status, markAnon, sqlRef } = useAuth();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);

  // Preference bật/tắt Plan evidence lưu trong localStorage
  const [planEnabled, setPlanEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const val = window.localStorage.getItem(PLAN_EVIDENCE_STORAGE_KEY);
      return val !== null ? val === "true" : true;
    } catch {
      return true;
    }
  });

  const effectivePlanEvidence = useMemo(() => {
    if (planEvidence && planEvidence.trim().length > 0) return planEvidence.trim();
    if (adapter.engine === "postgres" && evidence.plan) {
      try {
        return minifyPlanJson(evidence.plan);
      } catch {
        return null;
      }
    }
    return null;
  }, [planEvidence, adapter.engine, evidence.plan]);

  const isAttached = planEnabled && Boolean(effectivePlanEvidence);

  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const adapterRef = useRef(adapter);
  const verifying = useRef(false); // đọc đồng bộ, không phụ thuộc lần render (tránh dừng đúng lúc chuyển pha)

  // Lưu vết engine & sql trước đó để tự động reset thread khi đổi query / engine (Ca biên)
  const prevEngineRef = useRef(adapter.engine);
  const prevSqlRef = useRef(evidence.sql);

  useEffect(() => {
    adapterRef.current = adapter;
  });

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

  const resetChat = useCallback(async () => {
    await abortTurn();
    setTurns([]);
    setApplied(null);
    setQuestion("");
  }, [abortTurn]);

  // Tự động reset thread khi người dùng đổi sang query/sql khác hoặc đổi database engine
  useEffect(() => {
    const engineChanged = prevEngineRef.current !== adapter.engine;
    const sqlChanged = prevSqlRef.current !== evidence.sql;
    if (engineChanged || sqlChanged) {
      prevEngineRef.current = adapter.engine;
      prevSqlRef.current = evidence.sql;
      void resetChat();
    }
  }, [adapter.engine, evidence.sql, resetChat]);

  // Để hộp thoại đăng nhập lưu tạm đúng câu đang gõ; quay về thì trả lại (theo cách Task044).
  useEffect(() => {
    sqlRef.current = question;
  }, [question, sqlRef]);
  useEffect(() => {
    const saved = takeSql();
    if (saved) setQuestion((cur) => (cur === "" ? saved : cur)); // eslint-disable-line react-hooks/set-state-in-effect -- đọc sessionStorage một lần sau mount
  }, []);

  const patch = useCallback((id: number, p: Partial<Turn>) => {
    setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  useEffect(
    () => () => {
      void abortTurn();
    },
    [abortTurn],
  );

  async function send(overrideQuestion?: string) {
    const q = (overrideQuestion ?? question).trim();
    if (!q || len(q) > MAX_QUESTION || turns.length >= MAX_TURNS) return;
    if (status === "anon") return setLoginOpen(true);

    const id = ++seq.current;
    setApplied(null);
    const newTurn: Turn = {
      id,
      question: q,
      text: "",
      phase: "sending",
      timestamp: Date.now(),
    };
    setTurns((cur) => [...cur, newTurn]);
    setQuestion(""); // Xóa trắng ô input ngay sau khi đưa vào thread

    const rebuilt = abortTurn();
    const ac = new AbortController();
    ctl.current = ac;
    let text = "";
    let started = false;
    const fail = (f: Fail) => patch(id, { phase: "failed", fail: f });

    try {
      if (!(await rebuilt)) patch(id, { rebuildFailed: true });
      if (ac.signal.aborted) return;

      // Trích xuất Rolling Summary từ các turns trước đó (AC2)
      const contextSummary = buildContextSummary(turns);
      const isExplicit = Boolean(overrideQuestion);
      const allowPlan = canRunExplain(adapter.engine, isExplicit);
      const shouldAttachPlan = planEnabled && effectivePlanEvidence && allowPlan;

      const req: MentorRequest = {
        question: q,
        evidence,
        locale,
        ...(contextSummary ? { contextSummary } : {}),
        ...(shouldAttachPlan ? { evidence_plan: effectivePlanEvidence } : {}),
      };

      const res = await sendMentorChat({ request: req, signal: ac.signal });

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

  const activeTurn = turns.find((t) => BUSY.has(t.phase));
  const busy = activeTurn !== undefined;

  async function stop() {
    if (!activeTurn) return;
    patch(activeTurn.id, {
      phase: "stopped",
      check: activeTurn.check ?? (activeTurn.text ? checkAnswer(activeTurn.text, evidence) : undefined),
    });
    if (!(await abortTurn())) patch(activeTurn.id, { rebuildFailed: true });
  }

  const over = len(question) > MAX_QUESTION;
  const reachedMax = turns.length >= MAX_TURNS;

  return (
    <section aria-label={t("region")} className="flex min-w-0 flex-col gap-3" data-testid="mentor">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink2">{t("region")}</span>
          <span className="text-xs text-dim" data-testid="mentor-turn-count">
            {t("turnCount", { current: turns.length, max: MAX_TURNS })}
          </span>
        </div>
        {turns.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void resetChat()}
            data-testid="mentor-new-chat"
            className="h-7 text-xs text-dim hover:text-ink"
          >
            {t("newChat")}
          </Button>
        )}
      </div>

      <p role="note" className="m-0 text-xs text-ink2" data-testid="mentor-disclaimer">
        {t("disclaimer")}
      </p>

      {/* Luồng hội thoại đa lượt Thread View */}
      <ConversationThread
        turns={turns}
        maxTurns={MAX_TURNS}
        tr={tr}
        probe={probe}
        onApply={(a) => setApplied(a)}
        onLogin={() => setLoginOpen(true)}
      />

      {applied && (
        <section aria-label={t("applyRegion")} className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" data-testid="mentor-applied">
          <h3 className="m-0 text-sm font-semibold">{t("applyRegion")}</h3>
          <p className="m-0 text-xs text-ink2">{t("applyHint")}</p>
          <WhatIfCompare key={applied.n} adapter={adapter} probe={applied.probe} initialChange={applied.change} />
        </section>
      )}

      {/* Cảnh báo đạt giới hạn 5 turns */}
      {reachedMax && (
        <Alert data-testid="mentor-max-turns" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <AlertDescription>
            {t("maxTurnsReached", { max: MAX_TURNS })}
          </AlertDescription>
        </Alert>
      )}

      {/* Form nhập câu hỏi & Smart Controls */}
      <div
        className="flex min-w-0 flex-col gap-2.5 border-t border-line pt-3"
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      >
        {/* Cụm Quick-Action Chips khi có câu SQL */}
        {Boolean(evidence.sql?.trim()) && (
          <div className="pb-1">
            <QuickActionChips
              onTrigger={(prompt) => void send(prompt)}
              isPlanReady={Boolean(effectivePlanEvidence)}
              disabled={busy || reachedMax}
              isBusy={busy}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="mentor-question" className="text-sm font-semibold">
            {t("questionLabel")}
          </label>
          <PlanEvidencePill
            engine={adapter.engine}
            isAttached={isAttached}
            isMeasuring={isMeasuring}
            onToggle={setPlanEnabled}
          />
        </div>
        <Textarea
          id="mentor-question"
          data-testid="mentor-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("questionPlaceholder")}
          aria-invalid={over}
          aria-describedby="mentor-count"
          disabled={reachedMax}
          className="max-h-48 min-h-20"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="mentor-count" className={`m-0 text-xs ${over ? "text-destructive" : "text-dim"}`} data-testid="mentor-count">
            {over ? t("tooLong", { count: len(question), max: MAX_QUESTION }) : t("count", { count: len(question), max: MAX_QUESTION })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void send()}
            disabled={!question.trim() || over || busy || reachedMax}
            data-testid="mentor-send"
          >
            {t("send")}
          </Button>
          {busy && (
            <Button variant="outline" onClick={() => void stop()} data-testid="mentor-stop">
              {t("stop")}
            </Button>
          )}
          <span className="text-xs text-dim">{t("shortcut")}</span>
        </div>
      </div>

      <LoginDialog open={loginOpen} reason="ai" onClose={() => setLoginOpen(false)} />
    </section>
  );
}
export { buildContextSummary, VerifiedBlock } from "./conversation-thread";
