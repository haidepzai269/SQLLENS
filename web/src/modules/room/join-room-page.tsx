"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, LogIn, UserPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { currentNext } from "@/modules/auth/api";
import { useAuth } from "@/modules/auth/auth-provider";
import { markPendingProject } from "@/modules/workspace/pending-project";
import type { WorkspaceScope } from "@/modules/workspace/types";
import { joinRoom } from "./api";
import { classifyJoinError, ensureJoinedProject, type JoinErrorKind } from "./join";

type Phase = "auth" | "ready" | "joining" | "done" | "error";

/**
 * Trang `/join?token=...` (Task162).
 *
 * Route phải nằm trong `[locale]` — `/join` trần ở `web/src/app/` sẽ 404 vì layout của `[locale]`
 * gọi `notFound()` khi locale không hợp lệ và `generateStaticParams` chỉ sinh `vi`/`en`.
 *
 * Người chưa đăng nhập được chuyển sang `/login?next=...` và quay lại đây sau khi đăng nhập; phòng
 * là cloud project nên không có đường vào ẩn danh.
 *
 * Sau khi tham gia, dự án được kéo về IndexedDB rồi tải lại workspace (`location.assign`). Tải lại
 * là cố ý: `bootWorkspace` chỉ chạy lúc Lab mount, nên điều hướng client-side sẽ mở Lab với
 * workspace cũ và người dùng không thấy phòng vừa vào.
 */
export function JoinRoomPage() {
  const t = useTranslations("room.join");
  const locale = useLocale();
  const params = useSearchParams();
  const router = useRouter();
  const { status, user } = useAuth();

  const token = (params.get("token") ?? "").trim();
  // `null` = chưa có hành động nào từ người dùng, trạng thái suy ra từ phiên đăng nhập. Không
  // đồng bộ hai nguồn bằng setState trong effect: chưa đăng nhập thì `auth` là đúng, đã đăng nhập
  // thì `ready`, server không trả lời được thì `error`.
  const [step, setStep] = useState<Phase | null>(null);
  const [error, setError] = useState<JoinErrorKind | null>(null);
  // Ghi nhận đã vào phòng trên server hay chưa: nếu `joinRoom` thành công nhưng bước lưu vào
  // IndexedDB phía sau hỏng, phải báo rõ đã là thành viên + cho nút mở workspace thay vì nói
  // "Không tham gia được phòng" khiến người dùng tưởng link mời hỏng.
  const [joinedServer, setJoinedServer] = useState(false);

  const phase: Phase =
    step ?? (status === "unavailable" ? "error" : status === "user" ? "ready" : "auth");
  const errorKind: JoinErrorKind = error ?? (status === "unavailable" ? "network" : "failed");

  const goToLogin = useCallback(() => {
    router.replace(`/${locale}/login?next=${encodeURIComponent(currentNext())}`);
  }, [locale, router]);

  // Chưa đăng nhập: sang trang đăng nhập rồi quay lại đúng URL này (giữ token). Khung bên dưới
  // vẫn hiện nút đăng nhập: nếu điều hướng tự động không chạy, người dùng có đường khác.
  useEffect(() => {
    if (status !== "anon") return;
    goToLogin();
  }, [status, goToLogin]);

  // Khoá theo ref chứ không theo state: hai cú bấm sát nhau đều thấy state cũ, và hai lần chạy
  // chồng nhau sẽ kéo cùng một dự án hai lần → hai bản sao của phòng trong IndexedDB.
  const joining = useRef(false);

  const join = useCallback(async () => {
    if (joining.current) return;
    if (!token) {
      setError("invalid");
      setStep("error");
      return;
    }
    if (!user) {
      setError("auth");
      setStep("error");
      return;
    }
    joining.current = true;
    setJoinedServer(false);
    setError(null);
    setStep("joining");
    const scope: WorkspaceScope = { kind: "user", userId: user.id };
    try {
      const result = await joinRoom(token);
      setJoinedServer(true);
      const opened = await ensureJoinedProject(result.projectId, scope);
      setStep("done");
      // Từ đây người dùng ĐÃ là thành viên và dự án đã nằm trên máy: dấu chờ và điều hướng chỉ là
      // bước tiện lợi, hỏng thì vẫn phải nói "đã tham gia" chứ không phải "không tham gia được".
      try {
        markPendingProject(opened.projectId);
      } catch {
        // sessionStorage bị chặn: dự án vẫn ở danh sách, chỉ không tự mở sẵn.
      }
      try {
        // Tải lại thật thay vì `router.push`: `bootWorkspace` chỉ chạy khi Lab mount, nên điều hướng
        // client-side sẽ mở Lab với workspace cũ và người dùng không thấy phòng vừa vào.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/${locale}`);
      } catch {
        // Điều hướng bị chặn (CSP…): giữ màn hình "đã tham gia" thay vì báo lỗi sai.
      }
    } catch (err) {
      setError(classifyJoinError(err));
      setStep("error");
    } finally {
      joining.current = false;
    }
  }, [token, user, locale]);

  // Máy chủ không trả lời được (status=unavailable) thì nút "Đăng nhập" cũng không cứu được:
  // chỉ hiện "Thử lại" khi đã có người dùng thật để thử lại.
  const canRetry = user !== null && errorKind !== "invalid" && errorKind !== "expired";

  const message = (() => {
    if (joinedServer) {
      return errorKind === "storage" ? t("joinedStorageFailed") : t("joinedSaveFailed");
    }
    switch (errorKind) {
      case "expired":
        return t("expired");
      case "invalid":
        return t("invalid");
      case "forbidden":
        return t("forbidden");
      case "auth":
        return t("signedOut");
      case "network":
        return t("unavailable");
      case "storage":
        return t("storage");
      default:
        return t("failed");
    }
  })();

  return (
    <main className="mx-auto flex w-full max-w-[560px] min-w-0 flex-col gap-4 px-[var(--edge)] py-8">
      <div className="flex items-center gap-2">
        <UserPlus className="size-5 text-primary" aria-hidden="true" />
        <h1 className="m-0 text-lg font-semibold">{t("title")}</h1>
      </div>
      <p className="m-0 text-sm leading-relaxed text-ink2">{t("lead")}</p>

      {phase === "auth" && status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="room-join-auth-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>{t("checking")}</span>
        </div>
      )}

      {phase === "auth" && status === "anon" && (
        <div className="flex flex-col gap-3" data-testid="room-join-signed-out">
          <p className="m-0 text-sm leading-relaxed text-ink2">{t("signedOut")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={goToLogin} data-testid="room-join-signin">
              <LogIn className="size-3.5" aria-hidden="true" />
              <span>{t("signIn")}</span>
            </Button>
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("home")}
            </Link>
          </div>
        </div>
      )}

      {phase === "joining" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="room-join-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>{t("joining")}</span>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col gap-3" data-testid="room-join-done">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t("success")}</span>
          </div>
          {/* Điều hướng tự động có thể bị chặn (CSP, tiện ích trình duyệt): không có đường dự
              phòng thì người đã tham gia xong lại không mở được phòng vừa vào. */}
          <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
            {t("openWorkspace")}
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-3" data-testid="room-join-error">
          <Alert variant="destructive">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <AlertDescription className="text-xs leading-relaxed">{message}</AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            {user === null ? (
              errorKind === "network" ? null : (
                <Button type="button" size="sm" onClick={goToLogin} data-testid="room-join-signin">
                  <LogIn className="size-3.5" aria-hidden="true" />
                  <span>{t("signIn")}</span>
                </Button>
              )
            ) : (
              canRetry && (
                <Button type="button" size="sm" onClick={() => void join()}>
                  {t("retry")}
                </Button>
              )
            )}
            {joinedServer && (
              <Link
                href="/"
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid="room-join-open-workspace"
              >
                {t("openWorkspace")}
              </Link>
            )}
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("home")}
            </Link>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <div className="flex flex-col gap-2">
          {!token && (
            <Alert variant="destructive" data-testid="room-join-missing-token">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <AlertDescription className="text-xs leading-relaxed">{t("missingToken")}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            onClick={() => void join()}
            disabled={!token}
            className="w-full gap-2 sm:w-auto"
            data-testid="room-join-button"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            <span>{t("join")}</span>
          </Button>
        </div>
      )}
    </main>
  );
}
