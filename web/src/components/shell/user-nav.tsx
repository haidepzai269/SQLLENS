"use client";

import * as React from "react";
import { useState } from "react";
import { Crown, LogOut, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { VipBadge } from "@/components/ui/vip-badge";
import { UpgradeModal } from "@/modules/vip/upgrade-modal";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/shell/tip";
import { useAuth } from "@/modules/auth/auth-provider";
import { usePathname, useRouter } from "@/i18n/navigation";
import { parseEngine } from "@/components/shell/engine-tabs";
import { useSearchParams } from "next/navigation";
import { LogoutDialog } from "@/modules/workspace/components/logout-dialog";
import { hasUserLocalDrafts, purgeUserScope } from "@/modules/workspace/logout-flow";

const toPostgres = (router: ReturnType<typeof useRouter>, pathname: string) => {
  const q = new URLSearchParams(window.location.search);
  q.set("engine", "postgres");
  router.replace(`${pathname}?${q}${window.location.hash}`);
};

export interface UserNavProps {
  className?: string;
}

export function UserNav({ className }: UserNavProps) {
  const tAuth = useTranslations("auth");
  const tShell = useTranslations("shell");
  const tVip = useTranslations("vip");
  const { user, logout, markAnon, setBanner } = useAuth();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const searchParams = useSearchParams();
  const engine = parseEngine(searchParams ? searchParams.get("engine") : null);
  const router = useRouter();
  const pathname = usePathname();

  const isVip = Boolean(user?.isVip || user?.role === "vip");

  const performLogout = async (choice?: "delete" | "keep") => {
    setLeaving(true);
    try {
      if (choice === "delete" && user?.id) {
        try {
          await purgeUserScope(user.id);
        } catch {
          // Xóa lỗi giữa đường vẫn ghi nhận và cho phép logout tiếp tục để người dùng không bị kẹt
        }
      }
      const ok = await logout();
      if (!ok) {
        setBanner("logoutFailed");
        return;
      }
      if (engine === "mysql") toPostgres(router, pathname);
      markAnon();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <>
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        {/* Nút Nâng cấp VIP nếu chưa là VIP (dành cho cả User thường và Guest) */}
        {!isVip && (
          <Tip label={tVip("subtitle")}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUpgradeOpen(true)}
              className="h-7 px-2.5 gap-1.5 border-amber-400/50 hover:border-amber-400 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 font-medium text-xs shadow-xs transition-all animate-pulse hover:animate-none"
              data-testid="upgrade-vip-button"
            >
              <Crown className="size-3.5 text-amber-500 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{tVip("upgradeCta")}</span>
            </Button>
          </Tip>
        )}

        {/* Dropdown Menu Avatar */}
        {user && (
          <DropdownMenu>
            <Tip label={tShell("tip.account")}>
              <DropdownMenuTrigger
                aria-label={tAuth("menu", { name: user.name })}
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) +
                  " h-7 max-w-48 gap-1.5 px-2 py-0"
                }
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar từ provider
                  <img
                    src={user.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-5 rounded-full shrink-0 ring-1 ring-border"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {[...user.name][0]?.toUpperCase()}
                  </span>
                )}
                <span className="truncate max-[900px]:sr-only text-xs font-medium">
                  {user.name}
                </span>

                {/* Badge VIP cạnh tên trong trigger avatar nếu là VIP */}
                {isVip && <VipBadge size="sm" className="ml-0.5 shrink-0" />}
              </DropdownMenuTrigger>
            </Tip>

            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate leading-none">
                        {user.name}
                      </p>
                      {isVip && <VipBadge size="sm" />}
                    </div>
                    {user.vipUntil && isVip && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                        {tVip("vipUntilLabel", {
                          date: new Date(user.vipUntil).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }),
                        })}
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Mục Nâng cấp VIP hoặc Trạng thái VIP */}
              {isVip ? (
                <DropdownMenuItem
                  onClick={() => setUpgradeOpen(true)}
                  className="gap-2 text-xs text-amber-600 dark:text-amber-400 font-medium focus:text-amber-600 cursor-pointer"
                >
                  <Sparkles className="size-3.5 text-amber-500 shrink-0" aria-hidden="true" />
                  <span>{tVip("renewButton")}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setUpgradeOpen(true)}
                  className="gap-2 text-xs text-amber-600 dark:text-amber-400 font-semibold focus:text-amber-600 cursor-pointer"
                >
                  <Crown className="size-3.5 text-amber-500 shrink-0" aria-hidden="true" />
                  <span>{tVip("upgradeCta")}</span>
                </DropdownMenuItem>
              )}

              {/* Đường dẫn tới /settings */}
              <DropdownMenuItem
                onClick={() => router.push("/settings")}
                className="gap-2 text-xs cursor-pointer"
              >
                <SettingsIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{tShell("toggles.advancedSettings")}</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                disabled={leaving}
                onClick={async () => {
                  if (leaving) return;
                  if (!user) {
                    await performLogout();
                    return;
                  }
                  try {
                    const hasDrafts = await hasUserLocalDrafts(user.id);
                    if (hasDrafts) {
                      setLogoutDialogOpen(true);
                    } else {
                      await performLogout();
                    }
                  } catch {
                    await performLogout();
                  }
                }}
                className="gap-2 text-xs text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{tAuth("signOut")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Modal Nâng cấp VIP */}
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      {/* Modal Đăng xuất & Xóa nháp máy dùng chung */}
      <LogoutDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        loading={leaving}
        onConfirm={async (choice) => {
          setLogoutDialogOpen(false);
          await performLogout(choice);
        }}
        onCancel={() => {
          setLogoutDialogOpen(false);
        }}
      />
    </>
  );
}

export default UserNav;
