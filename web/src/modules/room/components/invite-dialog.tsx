"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, UserPlus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/auth/auth-provider";
import { useWorkspaceStore } from "@/modules/workspace/store";
import {
  createInvite,
  inviteUrl,
  listMembers,
  RoomApiError,
  type RoomMember,
} from "../api";

export interface InviteDialogProps {
  disabled?: boolean;
  className?: string;
}

/**
 * Trạng thái của phần danh sách thành viên.
 *
 * `forbidden` KHÔNG phải lỗi chung: thành viên thường (không phải chủ) luôn nhận 403 từ server vì
 * policy RLS chỉ cho họ thấy hàng của chính mình. Hiển thị "không tải được" sẽ khiến họ tưởng
 * phòng hỏng, nên tách thành câu riêng "chỉ chủ dự án mới xem được".
 *
 * `auth` là 401: hộp thoại mở được cả khi chưa đăng nhập, và "không tải được" sẽ khiến người lạ
 * tưởng phòng hỏng thay vì biết mình cần đăng nhập.
 */
type MembersState = "idle" | "loading" | "ready" | "forbidden" | "auth" | "error";

/** Vé đã tạo, gắn với đúng dự án đã tạo nó. */
type InviteLink = { cloudId: string; url: string; expiresAt: string };

type CreateError = "forbidden" | "auth" | "failed";

type CopyState = "idle" | "copied" | "failed";

/**
 * Hộp thoại mời cộng tác (Task162).
 *
 * Chỉ gọi mạng khi hộp thoại mở hoặc khi người dùng bấm "Tạo liên kết mời" — mở hộp thoại không
 * tự sinh vé (mỗi vé là một hàng trong database, sống 24 giờ).
 *
 * Phòng là một cloud project, nên dự án chưa lưu lên cloud thì không có id để mời. Trạng thái đó
 * được báo trước khi gọi bất kỳ endpoint nào, thay vì để server trả 404 khó hiểu.
 */
export function InviteDialog({ disabled = false, className }: InviteDialogProps) {
  const t = useTranslations("room.invite");
  const locale = useLocale();
  const { user } = useAuth();

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  // Không rơi về `projects[0]`: hộp thoại phải mời đúng dự án người dùng đang xem, còn dự án đầu
  // tiên trong danh sách thì không liên quan gì tới màn hình trước mặt — gửi nhầm phòng.
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const cloudId = project?.cloud?.remoteId;

  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [membersState, setMembersState] = useState<MembersState>("idle");
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<CreateError | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Vé chỉ được hiện khi còn đúng dự án đã tạo nó: chuyển sang dự án khác mà vẫn thấy link cũ sẽ
  // khiến chủ gửi nhầm phòng, và nút "Tạo liên kết mời" bị link cũ che mất.
  // Không phán đoán hết hạn bằng đồng hồ client (lệch giờ hoặc mở hộp thoại qua hạn 24h sẽ
  // giấu mất link hoặc làm mất đường tạo lại): server trả 410 khi người nhận bấm link là nguồn
  // sự thật duy nhất, còn chủ phòng luôn có nút "Tạo liên kết mới" cạnh link.
  const current = invite && cloudId && invite.cloudId === cloudId ? invite : null;
  const link = current ? current.url : null;
  const expiresAt = current ? current.expiresAt : null;
  // Mỗi lần đóng hộp thoại hoặc tạo lại thì tăng số thứ tự: kết quả của request cũ về muộn bị bỏ,
  // không ghi vé của dự án trước vào trạng thái hiện tại.
  const createSeq = useRef(0);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // Nạp danh sách thành viên mỗi lần mở hộp thoại: người được mời có thể vừa vào sau lần mở trước.
  // Trạng thái "loading" được đặt trong `change()` (sự kiện mở), không đặt đồng bộ trong effect —
  // setState đồng bộ trong effect gây render dây chuyền và bị lint chặn.
  useEffect(() => {
    if (!open || !cloudId) return;
    let cancelled = false;
    listMembers(cloudId)
      .then((list) => {
        if (cancelled) return;
        setMembers(list);
        setMembersState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof RoomApiError && err.status === 403) setMembersState("forbidden");
        else if (err instanceof RoomApiError && err.status === 401) setMembersState("auth");
        else setMembersState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, cloudId]);

  const change = (next: boolean) => {
    if (disabled && next) return;
    if (!next) {
      // Đóng hộp thoại khi `POST /invite` còn bay: bỏ kết quả và nhả trạng thái "đang tạo", nếu
      // không vé được tạo ngầm và lần mở sau link xuất hiện bất ngờ.
      createSeq.current += 1;
      setCreating(false);
    }
    if (next) {
      setCopyState("idle");
      setCreateError(null);
      setMembersState(cloudId ? "loading" : "ready");
    }
    setOpen(next);
  };

  const create = async () => {
    if (!cloudId || creating) return;
    const seq = createSeq.current + 1;
    createSeq.current = seq;
    setCreating(true);
    setCreateError(null);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyState("idle");
    try {
      const created = await createInvite(cloudId);
      if (seq !== createSeq.current) return;
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "https://sqllens.local";
      setInvite({ cloudId, url: inviteUrl(origin, locale, created.token), expiresAt: created.expiresAt });
    } catch (err) {
      if (seq !== createSeq.current) return;
      if (err instanceof RoomApiError && err.status === 403) setCreateError("forbidden");
      else if (err instanceof RoomApiError && err.status === 401) setCreateError("auth");
      else setCreateError("failed");
    } finally {
      if (seq === createSeq.current) setCreating(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    let ok = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    if (!ok) {
      // Clipboard bị chặn: chọn sẵn nội dung để người dùng Ctrl+C và nói rõ là chưa sao chép.
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyState("failed");
      copyTimer.current = setTimeout(() => setCopyState("idle"), 4000);
      return;
    }
    setCopyState("copied");
    copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  const expiry = (() => {
    if (!expiresAt) return "";
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(locale === "en" ? "en" : "vi", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
    } catch {
      return "";
    }
  })();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => change(true)}
        className={cn("h-7 gap-1.5 px-2.5 text-xs font-medium", className)}
        data-testid="room-invite-trigger"
        aria-label={t("button")}
      >
        <UserPlus className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t("button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={change}>
        <DialogContent
          className="w-full max-w-[calc(100%-2rem)] sm:max-w-md p-5 gap-4"
          data-testid="room-invite-dialog"
        >
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <UserPlus className="size-4 text-primary" aria-hidden="true" />
              <span>{t("title")}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          {!cloudId ? (
            <Alert data-testid="room-invite-not-saved">
              <AlertDescription className="text-xs leading-relaxed">{t("notSaved")}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-2">
                {link ? (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        ref={inputRef}
                        readOnly
                        value={link}
                        className="h-8 min-w-0 flex-1 truncate font-mono text-xs select-all"
                        data-testid="room-invite-link"
                        aria-label={t("linkLabel")}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={copy}
                        className="h-8 shrink-0 gap-1.5 text-xs"
                        data-testid="room-invite-copy"
                      >
                        {copyState === "copied" ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                        <span role="status" aria-live="polite">
                          {copyState === "copied" ? t("copied") : t("copy")}
                        </span>
                      </Button>
                    </div>
                    {copyState === "failed" && (
                      <p
                        role="alert"
                        className="text-[11px] leading-relaxed text-destructive"
                        data-testid="room-invite-copy-error"
                      >
                        {t("copyFailed")}
                      </p>
                    )}
                    <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="room-invite-hint">
                      {expiry ? `${t("expires", { time: expiry })} ` : ""}
                      {t("expiresHint")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={create}
                      disabled={creating}
                      className="self-start gap-2 text-xs"
                      data-testid="room-invite-regenerate"
                    >
                      {creating ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{creating ? t("creating") : t("regenerate")}</span>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={create}
                      disabled={creating}
                      className="w-full gap-2"
                      data-testid="room-invite-create"
                    >
                      {creating ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{creating ? t("creating") : t("create")}</span>
                    </Button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("expiresHint")}</p>
                  </>
                )}
                {createError && (
                  <p role="alert" className="text-[11px] leading-relaxed text-destructive" data-testid="room-invite-create-error">
                    {createError === "forbidden"
                      ? t("ownerOnly")
                      : createError === "auth"
                        ? t("authRequired")
                        : t("error")}
                  </p>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-2 border-t border-line pt-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t("members")}</span>
                </div>

                {membersState === "loading" && (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" data-testid="room-members-loading">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    <span>{t("loading")}</span>
                  </div>
                )}

                {membersState === "forbidden" && (
                  <p className="text-xs leading-relaxed text-muted-foreground" data-testid="room-members-forbidden">
                    {t("ownerOnly")}
                  </p>
                )}

                {membersState === "auth" && (
                  <p className="text-xs leading-relaxed text-muted-foreground" data-testid="room-members-auth">
                    {t("authRequired")}
                  </p>
                )}

                {membersState === "error" && (
                  <p role="alert" className="text-xs leading-relaxed text-destructive" data-testid="room-members-error">
                    {t("error")}
                  </p>
                )}

                {membersState === "ready" && (
                  <ul
                    className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto"
                    data-testid="room-member-list"
                    aria-label={t("members")}
                  >
                    {members.length === 0 ? (
                      <li className="text-xs text-muted-foreground" data-testid="room-members-empty">
                        {t("membersEmpty")}
                      </li>
                    ) : (
                      members.map((m) => (
                        <li
                          key={m.userId}
                          className="flex min-w-0 items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                          data-testid="room-member-row"
                        >
                          <span className="min-w-0 truncate">
                            {m.name}
                            {user?.id === m.userId && (
                              <span className="ml-1.5 text-[11px] text-muted-foreground">({t("you")})</span>
                            )}
                          </span>
                          <Badge variant={m.role === "owner" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                            {t(`role.${m.role}`)}
                          </Badge>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => change(false)}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
