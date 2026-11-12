import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import authMessagesVi from "../../../messages/vi/auth.json";
import shellMessagesVi from "../../../messages/vi/shell.json";
import vipMessagesVi from "../../../messages/vi/vip.json";
import { AuthContext, type Auth } from "@/modules/auth/auth-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserNav } from "./user-nav";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, className, ...props }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/lab",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeAuth = (userOverride?: Partial<Auth["user"]>, statusOverride: Auth["status"] = "user"): Auth => ({
  status: statusOverride,
  user: userOverride
    ? {
        id: "usr_1",
        name: "Dev User",
        provider: "github",
        role: "user",
        vipUntil: null,
        isVip: false,
        ...userOverride,
      }
    : null,
  markAnon: vi.fn(),
  logout: vi.fn().mockResolvedValue(true),
  refreshUser: vi.fn().mockResolvedValue(undefined),
  banner: null,
  setBanner: vi.fn(),
  sqlRef: { current: "" },
});

function renderUserNav(auth: Auth) {
  return render(
    <NextIntlClientProvider
      locale="vi"
      messages={{
        auth: authMessagesVi,
        shell: shellMessagesVi,
        vip: vipMessagesVi,
      }}
    >
      <TooltipProvider>
        <AuthContext.Provider value={auth}>
          <UserNav />
        </AuthContext.Provider>
      </TooltipProvider>
    </NextIntlClientProvider>
  );
}

describe("UserNav Component (Task107)", () => {
  it("AC2: Hiển thị nút Nâng cấp VIP với tài khoản user thường", () => {
    const auth = makeAuth({ role: "user", isVip: false });
    renderUserNav(auth);

    const upgradeBtn = screen.getByTestId("upgrade-vip-button");
    expect(upgradeBtn).toBeTruthy();
    expect(upgradeBtn.textContent).toContain("Nâng cấp VIP");
  });

  it("AC1: Tài khoản VIP hiển thị VipBadge cạnh tên và không có nút nâng cấp bên ngoài", () => {
    const auth = makeAuth({
      role: "vip",
      isVip: true,
      vipUntil: "2027-01-01T00:00:00Z",
    });
    renderUserNav(auth);

    // Nút nâng cấp bên ngoài không hiển thị
    expect(screen.queryByTestId("upgrade-vip-button")).toBeNull();

    // Trigger avatar có VipBadge
    const badge = screen.getByRole("status", { name: "VIP Member" });
    expect(badge).toBeTruthy();
    expect(screen.getByText("Dev User")).toBeTruthy();
  });

  it("AC2: Khách (Guest) vẫn thấy nút Nâng cấp VIP", () => {
    const auth = makeAuth(undefined, "anon");
    renderUserNav(auth);

    const upgradeBtn = screen.getByTestId("upgrade-vip-button");
    expect(upgradeBtn).toBeTruthy();
  });

  it("Bấm nút Nâng cấp VIP mở UpgradeModal", () => {
    const auth = makeAuth({ role: "user", isVip: false });
    renderUserNav(auth);

    const upgradeBtn = screen.getByTestId("upgrade-vip-button");
    act(() => {
      fireEvent.click(upgradeBtn);
    });

    // Modal tiêu đề xuất hiện
    expect(screen.getByText("Nâng Cấp Gói VIP Hoàng Gia")).toBeTruthy();
  });
});
