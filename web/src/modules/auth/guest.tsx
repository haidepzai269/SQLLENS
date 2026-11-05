"use client";

import { useRef, useSyncExternalStore } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EngineId } from "@/contracts/engine";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { parseSql } from "@/modules/sql-intake/parser";
import type { StatementKind } from "@/modules/sql-intake/parser";
import { currentNext } from "./api";
import { useAuth } from "./auth-provider";
import { stashSql } from "./sql-stash";

// shortcut: lượt dùng thử đếm ở localStorage của trình duyệt và danh sách tab khóa chỉ ẩn ở giao diện. Người dùng xóa
// localStorage hoặc sửa mã là vượt được. Chấp nhận vì PGlite chạy ngay trong máy họ nên không tốn tài nguyên máy chủ
// (CLAUDE.md, dòng "Đăng nhập"). Đây là cách giới thiệu sản phẩm, không phải biện pháp bảo mật. MySQL và AI vẫn do Gin chặn.
export const GUEST_LIMIT = 2;
const KEY = "sqllens.guestRuns";
const ALLOWED: ReadonlySet<StatementKind> = new Set(["select", "insert", "update", "delete", "create_table"]);
export const GUEST_LOCKED_TABS: ReadonlySet<string> = new Set(["btree", "whatif", "capacity", "mentor"]);

let mem = 0; // localStorage bị chặn thì đếm trong bộ nhớ của tab
const subs = new Set<() => void>();

function readUsed(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return mem;
  }
}

export function guestRunDone() {
  const n = readUsed() + 1;
  mem = n;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* giữ ở bộ nhớ */
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  window.addEventListener("storage", f); // tab khác chạy xong thì số lượt ở đây cũng cập nhật
  return () => (subs.delete(f), window.removeEventListener("storage", f));
}

/** Khách là khi /api/me trả 401. Chưa biết (đang tải, Gin lỗi) thì không chặn. */
export function useGuest() {
  const { status } = useAuth();
  const used = useSyncExternalStore(subscribe, readUsed, () => 0);
  return { guest: status === "anon", left: Math.max(0, GUEST_LIMIT - used) };
}

export type GuestGate = "limit" | "blocked" | "parser";

/** null là cho chạy. Hết lượt thì không cần parse. Lỗi cú pháp vẫn cho đi (engine báo lỗi và không tính lượt); parser hỏng thì không cho qua. */
export async function guestCheck(sql: string, engine: EngineId): Promise<GuestGate | null> {
  if (readUsed() >= GUEST_LIMIT) return "limit";
  const o = await parseSql(sql, engine);
  if (!o.ok) return o.error.position === undefined ? "parser" : null;
  return o.statements.every((s) => ALLOWED.has(s.kind)) ? null : "blocked";
}

/** Link tới /login giữ nguyên chỗ đang đứng (next) và SQL đang soạn (sessionStorage). Lưu lỗi thì báo, bấm lần nữa mới đi. */
export function SignInLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const { sqlRef, setBanner } = useAuth();
  const router = useRouter();
  const warned = useRef(false);
  return (
    <Link
      href="/login"
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // mở tab mới thì để trình duyệt tự xử lý
        e.preventDefault();
        if (!stashSql(sqlRef.current) && !warned.current) {
          warned.current = true;
          setBanner("storageBlocked");
          return;
        }
        router.push({ pathname: "/login", query: { next: currentNext() } });
      }}
    >
      {children}
    </Link>
  );
}

const outline = buttonVariants({ variant: "outline", size: "sm" });

/** Số lượt còn lại (luôn hiện với khách) và lời mời khi bị chặn. */
export function GuestNote({ gate }: { gate: GuestGate | null }) {
  const t = useTranslations("auth.guest");
  const { guest, left } = useGuest();
  if (!guest) return null;
  return (
    <div className="flex flex-col items-start gap-2" data-testid="guest-note">
      <p role="status" className="m-0 text-xs text-muted-foreground" data-testid="guest-left">
        {t("left", { left, total: GUEST_LIMIT })}
      </p>
      {gate && (
        <Alert data-testid={`guest-${gate}`} role="alert">
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{t(gate, { total: GUEST_LIMIT })}</span>
            {gate !== "parser" && <SignInLink className={outline}>{t("signIn")}</SignInLink>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function LockedTab({ name, feature }: { name: string; feature?: boolean }) {
  const t = useTranslations("auth.guest");
  return (
    <Alert data-testid="locked-tab">
      <Lock aria-hidden />
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{t(feature ? "lockedFeature" : "locked", { tab: name })}</span>
        <SignInLink className={outline}>{t("signIn")}</SignInLink>
      </AlertDescription>
    </Alert>
  );
}
