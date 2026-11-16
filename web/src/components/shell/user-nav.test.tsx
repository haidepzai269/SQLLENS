import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import authMessagesVi from "../../../messages/vi/auth.json";
import shellMessagesVi from "../../../messages/vi/shell.json";
import vipMessagesVi from "../../../messages/vi/vip.json";
import workspaceMessagesVi from "../../../messages/vi/workspace.json";
import { AuthContext, type Auth } from "@/modules/auth/auth-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserNav } from "./user-nav";
import * as logoutFlow from "@/modules/workspace/logout-flow";

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
        workspace: workspaceMessagesVi,
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

  describe("Luồng Đăng xuất & Dọn nháp (Task129)", () => {
    it("Ca biên: Người dùng không có nháp -> gọi thẳng logout() không mở modal", async () => {
      vi.spyOn(logoutFlow, "hasUserLocalDrafts").mockResolvedValue(false);
      const auth = makeAuth({ role: "user" });
      renderUserNav(auth);

      // Mở dropdown avatar
      const trigger = screen.getByLabelText("Tài khoản của Dev User");
      await act(async () => {
        fireEvent.click(trigger);
      });

      // Bấm Đăng xuất
      const signOutItem = screen.getByText("Đăng xuất");
      await act(async () => {
        fireEvent.click(signOutItem);
      });

      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(auth.markAnon).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("logout-delete-button")).toBeNull();
    });

    it("AC1: Có nháp cục bộ -> hiển thị LogoutDialog với lựa chọn xóa là mặc định", async () => {
      vi.spyOn(logoutFlow, "hasUserLocalDrafts").mockResolvedValue(true);
      const auth = makeAuth({ role: "user" });
      renderUserNav(auth);

      const trigger = screen.getByLabelText("Tài khoản của Dev User");
      await act(async () => {
        fireEvent.click(trigger);
      });

      const signOutItem = screen.getByText("Đăng xuất");
      await act(async () => {
        fireEvent.click(signOutItem);
      });

      expect(auth.logout).not.toHaveBeenCalled();
      expect(screen.getByText("Đăng xuất khỏi thiết bị")).toBeTruthy();
      expect(screen.getByTestId("logout-delete-button")).toBeTruthy();
      expect(screen.getByTestId("logout-keep-button")).toBeTruthy();
      expect(screen.getByTestId("logout-cancel-button")).toBeTruthy();
    });

    it("AC4: Trong dialog chọn Hủy -> không đăng xuất, không xóa gì", async () => {
      vi.spyOn(logoutFlow, "hasUserLocalDrafts").mockResolvedValue(true);
      const purgeSpy = vi.spyOn(logoutFlow, "purgeUserScope").mockResolvedValue(0);
      const auth = makeAuth({ role: "user" });
      renderUserNav(auth);

      const trigger = screen.getByLabelText("Tài khoản của Dev User");
      await act(async () => {
        fireEvent.click(trigger);
      });

      const signOutItem = screen.getByText("Đăng xuất");
      await act(async () => {
        fireEvent.click(signOutItem);
      });

      const cancelBtn = screen.getByTestId("logout-cancel-button");
      await act(async () => {
        fireEvent.click(cancelBtn);
      });

      expect(purgeSpy).not.toHaveBeenCalled();
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it("AC3: Trong dialog chọn Giữ nháp -> gọi logout(), không gọi purgeUserScope", async () => {
      vi.spyOn(logoutFlow, "hasUserLocalDrafts").mockResolvedValue(true);
      const purgeSpy = vi.spyOn(logoutFlow, "purgeUserScope").mockResolvedValue(0);
      const auth = makeAuth({ role: "user" });
      renderUserNav(auth);

      const trigger = screen.getByLabelText("Tài khoản của Dev User");
      await act(async () => {
        fireEvent.click(trigger);
      });

      const signOutItem = screen.getByText("Đăng xuất");
      await act(async () => {
        fireEvent.click(signOutItem);
      });

      const keepBtn = screen.getByTestId("logout-keep-button");
      await act(async () => {
        fireEvent.click(keepBtn);
      });

      expect(purgeSpy).not.toHaveBeenCalled();
      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(auth.markAnon).toHaveBeenCalledTimes(1);
    });

    it("AC2: Trong dialog chọn Xóa nháp -> gọi purgeUserScope('usr_1') rồi logout()", async () => {
      vi.spyOn(logoutFlow, "hasUserLocalDrafts").mockResolvedValue(true);
      const purgeSpy = vi.spyOn(logoutFlow, "purgeUserScope").mockResolvedValue(3);
      const auth = makeAuth({ role: "user" });
      renderUserNav(auth);

      const trigger = screen.getByLabelText("Tài khoản của Dev User");
      await act(async () => {
        fireEvent.click(trigger);
      });

      const signOutItem = screen.getByText("Đăng xuất");
      await act(async () => {
        fireEvent.click(signOutItem);
      });

      const deleteBtn = screen.getByTestId("logout-delete-button");
      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      expect(purgeSpy).toHaveBeenCalledWith("usr_1");
      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(auth.markAnon).toHaveBeenCalledTimes(1);
    });
  });
});
