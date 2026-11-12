"use client";

import { Suspense, useEffect } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { parseEngine } from "@/components/shell/engine-tabs";
import { Tip } from "@/components/shell/tip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePathname, useRouter } from "@/i18n/navigation";
import { UserNav } from "@/components/shell/user-nav";
import { useAuth } from "./auth-provider";
import { SignInLink } from "./guest";
import { LoginDialog } from "./login-dialog";

const toPostgres = (router: ReturnType<typeof useRouter>, pathname: string) => {
  const q = new URLSearchParams(window.location.search);
  q.set("engine", "postgres");
  router.replace(`${pathname}?${q}${window.location.hash}`);
};

function Controls() {
  const t = useTranslations("auth");
  const ts = useTranslations("shell");
  const { status, user } = useAuth();
  const engine = parseEngine(useSearchParams().get("engine"));
  const router = useRouter();
  const pathname = usePathname();

  // Cổng MySQL suy ra từ URL và trạng thái: hủy thì về PostgreSQL, đăng nhập xong thì tự tắt.
  const gate = engine === "mysql" && status === "anon";
  const close = () => toPostgres(router, pathname);

  return (
    <div className="flex h-[var(--h-top)] items-center px-1 gap-2">
      {status === "loading" ? (
        <Skeleton aria-hidden className="h-7 w-20" data-testid="auth-skeleton" />
      ) : user ? (
        <UserNav />
      ) : (
        <>
          <UserNav />
          <Tip label={ts("tip.signIn")}>
            <SignInLink className={buttonVariants({ variant: "outline", size: "sm" }) + " h-7 text-xs font-medium"}>
              {t("signIn")}
            </SignInLink>
          </Tip>
        </>
      )}
      <LoginDialog open={gate} reason="mysql" onClose={close} />
    </div>
  );
}

export function AuthControls() {
  return (
    <Suspense fallback={<Skeleton aria-hidden className="mx-1 h-7 w-20" />}>
      <Controls />
    </Suspense>
  );
}

// ?auth_error=cancelled|failed do Gin gắn khi quay về: hiện câu rõ ràng rồi bỏ tham số khỏi URL.
function Notice() {
  const t = useTranslations("auth.banner");
  const { banner, setBanner } = useAuth();
  const err = useSearchParams().get("auth_error");
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (err === null) return;
    if (err === "cancelled" || err === "failed") setBanner(err);
    const q = new URLSearchParams(window.location.search);
    q.delete("auth_error");
    const s = q.toString();
    router.replace(`${pathname}${s ? `?${s}` : ""}${window.location.hash}`);
  }, [err, pathname, router, setBanner]);
  return banner ? (
    <p role="status" className="flex flex-none items-center gap-2 border-b border-line bg-surface px-[var(--edge)] py-1 text-ink2">
      <span className="min-w-0 flex-1">{t(banner)}</span>
      <Button variant="ghost" size="icon-sm" onClick={() => setBanner(null)} aria-label={t("dismiss")}>
        <X aria-hidden />
      </Button>
    </p>
  ) : null;
}

export function AuthNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
