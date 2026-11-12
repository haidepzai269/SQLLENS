import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import vipMessagesEn from "../../../messages/en/vip.json";
import vipMessagesVi from "../../../messages/vi/vip.json";
import { AuthContext, type Auth } from "@/modules/auth/auth-provider";
import { UpgradeModal } from "./upgrade-modal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const defaultAuthValue: Auth = {
  status: "user",
  user: {
    id: "user_123",
    name: "Alex Dev",
    provider: "github",
    role: "user",
    vipUntil: null,
    isVip: false,
  },
  markAnon: vi.fn(),
  logout: vi.fn().mockResolvedValue(true),
  refreshUser: vi.fn().mockResolvedValue(undefined),
  banner: null,
  setBanner: vi.fn(),
  sqlRef: { current: "" },
};

function renderUpgradeModal(
  props: { open: boolean; onOpenChange: (open: boolean) => void },
  authOverride: Partial<Auth> = {},
  locale: "vi" | "en" = "vi"
) {
  const messages = locale === "vi" ? vipMessagesVi : vipMessagesEn;
  const authValue: Auth = { ...defaultAuthValue, ...authOverride };

  return render(
    <NextIntlClientProvider locale={locale} messages={{ vip: messages }}>
      <AuthContext.Provider value={authValue}>
        <UpgradeModal {...props} />
      </AuthContext.Provider>
    </NextIntlClientProvider>
  );
}

describe("UpgradeModal Component (Task107)", () => {
  it("AC1 & AC3: Render đầy đủ bảng so sánh 2 cột Free vs VIP và form nạp mã", () => {
    const onOpenChange = vi.fn();
    renderUpgradeModal({ open: true, onOpenChange });

    // Tiêu đề và Modal
    expect(screen.getByText("Nâng Cấp Gói VIP Hoàng Gia")).toBeTruthy();
    expect(screen.getByText("Bản Miễn Phí")).toBeTruthy();
    expect(screen.getByText("Bản VIP Hoàng Gia")).toBeTruthy();

    // Tính năng so sánh
    expect(screen.getByText("Ghost text Heuristics tốc độ cao (0ms, 0đ)")).toBeTruthy();
    expect(screen.getByText("AI Copilot viết mã sâu đa dòng (Qwen 0.19s)")).toBeTruthy();
    expect(screen.getByText("Ưu tiên tài nguyên CPU container MySQL")).toBeTruthy();

    // Form nạp mã
    expect(screen.getByPlaceholderText(/NHẬP MÃ/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Kích hoạt ngay/i })).toBeTruthy();
  });

  it("AC4.1: Tự động uppercase khi nhập mã vào ô input", () => {
    const onOpenChange = vi.fn();
    renderUpgradeModal({ open: true, onOpenChange });

    const input = screen.getByPlaceholderText(/NHẬP MÃ/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sqllens2026" } });
    expect(input.value).toBe("SQLLENS2026");
  });

  it("AC4.2: Hiển thị lỗi khi mã kích hoạt không tồn tại hoặc không hợp lệ (invalid_code)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "invalid_code", messageKey: "error.invalidCode" },
        message: "Mã kích hoạt không hợp lệ",
      }),
    });

    const onOpenChange = vi.fn();
    renderUpgradeModal({ open: true, onOpenChange });

    const input = screen.getByPlaceholderText(/NHẬP MÃ/i);
    fireEvent.change(input, { target: { value: "WRONGCODE" } });

    const submitBtn = screen.getByRole("button", { name: /Kích hoạt ngay/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("redeem-error-message")).toBeTruthy();
      expect(screen.getByText("Mã kích hoạt không tồn tại hoặc không hợp lệ.")).toBeTruthy();
    });
  });

  it("AC4.3: Hiển thị lỗi khi mã kích hoạt đã sử dụng trước đó (code_already_redeemed)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "code_already_redeemed", messageKey: "error.codeAlreadyRedeemed" },
        message: "Bạn đã sử dụng mã kích hoạt này trước đó",
      }),
    });

    const onOpenChange = vi.fn();
    renderUpgradeModal({ open: true, onOpenChange });

    const input = screen.getByPlaceholderText(/NHẬP MÃ/i);
    fireEvent.change(input, { target: { value: "USEDCODE" } });

    const submitBtn = screen.getByRole("button", { name: /Kích hoạt ngay/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("redeem-error-message")).toBeTruthy();
      expect(screen.getByText("Bạn đã sử dụng mã kích hoạt này trước đó.")).toBeTruthy();
    });
  });

  it("AC4.4: Nạp mã thành công -> hiển thị card chúc mừng, gọi refreshUser và đóng modal", async () => {
    const refreshUserMock = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        role: "vip",
        vipUntil: "2027-01-01T00:00:00Z",
        message: "Kích hoạt VIP thành công",
      }),
    });

    const onOpenChange = vi.fn();
    renderUpgradeModal({ open: true, onOpenChange }, { refreshUser: refreshUserMock });

    const input = screen.getByPlaceholderText(/NHẬP MÃ/i);
    fireEvent.change(input, { target: { value: "PROMOVIP2026" } });

    const submitBtn = screen.getByRole("button", { name: /Kích hoạt ngay/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("redeem-success-card")).toBeTruthy();
      expect(screen.getByText("Kích hoạt VIP thành công!")).toBeTruthy();
      expect(screen.getByText(/Thời hạn VIP:/i)).toBeTruthy();
    });

    expect(refreshUserMock).toHaveBeenCalledTimes(1);

    // Bấm nút Bắt đầu trải nghiệm đóng modal
    const finishBtn = screen.getByRole("button", { name: /Bắt đầu trải nghiệm/i });
    fireEvent.click(finishBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
