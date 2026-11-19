"use client";

/**
 * Trang người nhận mở link chia sẻ.
 *
 * Payload nằm trong fragment (`#d=…`) nên trình duyệt không gửi nó lên server:
 * chỉ JavaScript ở máy khách đọc được. Trang này vì thế phải tự chuyển qua 4 trạng thái
 * thay vì để server render nội dung, và tuyệt đối không đẩy payload vào bất kỳ URL/API nào.
 *
 * Core Rule 7: nội dung snapshot không rời khỏi máy khách.
 */

import { useEffect, useState } from "react";
import { AlertCircle, Link2Off, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { decodeSnapshot } from "./codec";
import { ReadonlyWorkspace } from "./components/readonly-workspace";
import { SnapshotError, type SnapshotErrorCode, type SnapshotV1 } from "./snapshot";

export type ShareViewState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "invalid"; code: SnapshotErrorCode }
  | { status: "ready"; snapshot: SnapshotV1 };

/**
 * Tách tham số `d` khỏi hash. Trả `null` khi hash không có `d` (khác với `d` rỗng).
 *
 * Không dùng `URLSearchParams`: payload base64url không có ký tự cần giải mã, nhưng
 * `URLSearchParams` biến `+` thành khoảng trắng nên link kiểu base64 cũ sẽ hỏng âm thầm.
 */
export function extractPayload(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === "d") return part.slice(eq + 1);
  }
  return null;
}

function errorMessageKey(code: SnapshotErrorCode): string {
  switch (code) {
    case "SNAPSHOT_TOO_LARGE":
      return "view.errorTooLarge";
    case "SNAPSHOT_VERSION_UNSUPPORTED":
      return "view.errorVersion";
    case "SNAPSHOT_CORRUPT":
      return "view.errorCorrupt";
  }
}

export function ShareView() {
  const t = useTranslations("share");
  const [state, setState] = useState<ShareViewState>({ status: "loading" });

  useEffect(() => {
    // Đổi hash có thể xảy ra khi người dùng dán link khác vào cùng tab; lượt giải mã cũ
    // phải bị bỏ, nếu không snapshot trước có thể ghi đè snapshot sau.
    let generation = 0;
    // Gán hash bằng script cũng phát `hashchange`; giải mã lại cùng một payload sẽ nháy
    // trạng thái loading và có thể ghi đè kết quả vừa xong.
    let lastPayload: string | null | undefined;

    const read = async () => {
      const payload = extractPayload(window.location.hash);
      if (payload === lastPayload) return;
      lastPayload = payload;

      const current = ++generation;

      if (payload === null) {
        setState({ status: "missing" });
        return;
      }

      setState({ status: "loading" });
      try {
        const snapshot = await decodeSnapshot(payload);
        if (current === generation) setState({ status: "ready", snapshot });
      } catch (err) {
        if (current !== generation) return;
        const code = err instanceof SnapshotError ? err.code : "SNAPSHOT_CORRUPT";
        setState({ status: "invalid", code });
      }
    };

    void read();
    window.addEventListener("hashchange", read);
    return () => {
      generation++;
      window.removeEventListener("hashchange", read);
    };
  }, []);

  // Snapshot hợp lệ chiếm trọn màn hình: khung chỉ đọc tự có header và bề mặt riêng.
  if (state.status === "ready") return <ReadonlyWorkspace snapshot={state.snapshot} />;

  return (
    <main
      data-testid="share-view"
      data-status={state.status}
      className="flex min-h-dvh w-full flex-col bg-ground font-sans text-text"
    >
      {state.status === "loading" && (
        <div
          data-testid="share-loading"
          role="status"
          aria-live="polite"
          className="m-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <Loader2 className="size-6 animate-spin text-lamp" aria-hidden="true" />
          <p className="text-sm font-medium">{t("view.loading")}</p>
          <p className="text-xs leading-relaxed text-dim">{t("view.loadingHint")}</p>
        </div>
      )}

      {state.status === "missing" && (
        <div
          data-testid="share-missing"
          className="m-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <Link2Off className="size-7 text-dim" aria-hidden="true" />
          <h1 className="text-base font-semibold">{t("view.missingTitle")}</h1>
          <p className="text-sm leading-relaxed text-ink2">{t("view.missingBody")}</p>
          <Link
            href="/"
            data-testid="share-home-link"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("view.home")}
          </Link>
        </div>
      )}

      {state.status === "invalid" && (
        <div
          data-testid="share-invalid"
          className="m-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <AlertCircle className="size-7 text-negative" aria-hidden="true" />
          <h1 className="text-base font-semibold">{t("view.invalidTitle")}</h1>
          <p className="text-sm leading-relaxed text-ink2">{t("view.invalidBody")}</p>
          <p className="font-mono text-[11px] text-dim" data-testid="share-invalid-code">
            {t("view.errorCode", { code: state.code })} · {t(errorMessageKey(state.code))}
          </p>
          <Link
            href="/"
            data-testid="share-home-link"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("view.home")}
          </Link>
        </div>
      )}

    </main>
  );
}
