"use client";

import { Suspense, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { parseEngine } from "@/components/shell/engine-tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "./auth-provider";
import { LoginDialog } from "./login-dialog";

const toPostgres = (router: ReturnType<typeof useRouter>, pathname: string) => {
  const q = new URLSearchParams(window.location.search);
  q.set("engine", "postgres");
  router.replace(`${pathname}?${q}${window.location.hash}`);
};

function Controls() {
  const t = useTranslations("auth");
  const { status, user, logout, markAnon, setBanner } = useAuth();
  const engine = parseEngine(useSearchParams().get("engine"));
  const router = useRouter();
  const pathname = usePathname();
  const [manual, setManual] = useState(false);
  // Đang đăng xuất khỏi MySQL: URL đổi sau một nhịp, trong lúc đó không mở cổng.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (engine !== "mysql") setLeaving(false); // eslint-disable-line react-hooks/set-state-in-effect -- URL đã rời MySQL thì hết cờ
  }, [engine]);
  // Cổng MySQL suy ra từ URL và trạng thái, không qua effect: hủy thì về PostgreSQL, đăng nhập xong thì tự tắt.
  const gate = engine === "mysql" && status === "anon" && !leaving;
  const close = () => {
    setManual(false);
    if (gate) toPostgres(router, pathname);
  };

  return (
    <div className="flex h-[var(--h-top)] items-center px-1">
      {status === "loading" ? (
        <Skeleton aria-hidden className="h-7 w-20" data-testid="auth-skeleton" />
      ) : user ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("menu", { name: user.name })}
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " max-w-40 gap-2"}
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh của Google/GitHub, không qua trình tối ưu của Next
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-5 rounded-full" />
            ) : (
              <span aria-hidden className="grid size-5 place-items-center rounded-full bg-muted text-xs">
                {[...user.name][0]?.toUpperCase()}
              </span>
            )}
            <span className="truncate max-[900px]:sr-only">{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem
              onClick={async () => {
                setLeaving(true);
                if (!(await logout())) return setLeaving(false), setBanner("logoutFailed");
                if (engine === "mysql") toPostgres(router, pathname); // trước markAnon để cổng MySQL không chớp
                markAnon();
              }}
            >
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setManual(true)}>
          {t("signIn")}
        </Button>
      )}
      <LoginDialog open={manual || gate} reason={gate ? "mysql" : "manual"} onClose={close} />
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
