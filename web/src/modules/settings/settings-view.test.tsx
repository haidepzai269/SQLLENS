import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settingsMessagesEn from "../../../messages/en/settings.json";
import settingsMessagesVi from "../../../messages/vi/settings.json";
import { SettingsProvider, SETTINGS_STORAGE_KEY } from "@/contexts/settings-context";
import { AuthContext, type Auth } from "@/modules/auth/auth-provider";
import { SettingsView } from "./settings-view";

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
  usePathname: () => "/settings",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

function renderSettingsView(locale: "vi" | "en" = "vi") {
  const messages = locale === "vi" ? settingsMessagesVi : settingsMessagesEn;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ settings: messages }}>
      <SettingsProvider>
        <SettingsView />
      </SettingsProvider>
    </NextIntlClientProvider>
  );
}

describe("SettingsView (Task105)", () => {
  it("AC1 & AC4: Hiển thị liên kết Quay lại Không gian làm việc và tiêu đề trang", () => {
    renderSettingsView("vi");

    // Nút quay lại Workspace
    const backLink = screen.getByRole("link", { name: /Quay lại không gian làm việc/i });
    expect(backLink).toBeTruthy();
    expect(backLink.getAttribute("href")).toBe("/");

    // Tiêu đề trang
    expect(screen.getByRole("heading", { level: 1, name: "Cài đặt & Tùy chọn" })).toBeTruthy();
  });

  it("AC2: Hiển thị đầy đủ 4 phân khu chuẩn mực", () => {
    renderSettingsView("vi");

    // Phân khu 1: Soạn thảo SQL
    expect(screen.getByText("Soạn thảo SQL")).toBeTruthy();
    expect(screen.getByText("Hiển thị số dòng")).toBeTruthy();
    expect(screen.getByText("Tự động ngắt dòng")).toBeTruthy();
    expect(screen.getByText("Tô sáng dòng hiện tại")).toBeTruthy();
    expect(screen.getByText("Kích thước phông chữ")).toBeTruthy();

    // Phân khu 2: Giao diện & Màu sắc
    expect(screen.getByText("Giao diện & Màu sắc")).toBeTruthy();
    expect(screen.getByText("Chủ đề giao diện")).toBeTruthy();
    expect(screen.getByText("Chế độ tương phản cao")).toBeTruthy();

    // Phân khu 3: Trợ lý soạn thảo & Gợi ý mã
    expect(screen.getByText("Trợ lý soạn thảo & Gợi ý mã")).toBeTruthy();
    expect(screen.getByText(/Gợi ý viết tiếp trực tiếp/i)).toBeTruthy();
    expect(screen.getByText("0ms • 0đ")).toBeTruthy();
    expect(screen.getByText(/Menu gợi ý dạng popup/i)).toBeTruthy();
    expect(screen.getByText(/Gợi ý sâu từ AI Copilot/i)).toBeTruthy();
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.getByText(/Đặc quyền dành riêng cho VIP/i)).toBeTruthy();

    // Phân khu 4: Tài khoản & Phân quyền
    expect(screen.getByText("Tài khoản & Phân quyền")).toBeTruthy();
    expect(screen.getByText("Tiêu chuẩn (Miễn phí)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nâng cấp VIP/i })).toBeTruthy();
  });

  it("AC3: Các công tắc CustomSwitch phản hồi tương tác và lưu vào SettingsContext", () => {
    renderSettingsView("vi");

    // Line Numbers switch (Mặc định: true -> click để false)
    const lineNumbersSwitch = screen.getByLabelText("Hiển thị số dòng") as HTMLInputElement;
    expect(lineNumbersSwitch.checked).toBe(true);

    act(() => {
      fireEvent.click(lineNumbersSwitch);
    });
    expect(lineNumbersSwitch.checked).toBe(false);

    // Kiểm tra localStorage đã lưu lineNumbers: false
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(stored.lineNumbers).toBe(false);

    // Ghost Text switch (Mặc định: true -> click để false)
    const ghostTextSwitch = screen.getByLabelText(/Gợi ý viết tiếp trực tiếp/i) as HTMLInputElement;
    expect(ghostTextSwitch.checked).toBe(true);

    act(() => {
      fireEvent.click(ghostTextSwitch);
    });
    expect(ghostTextSwitch.checked).toBe(false);

    // Dropdown Autocomplete switch (Mặc định: false -> click để true)
    const dropdownSwitch = screen.getByLabelText(/Menu gợi ý dạng popup/i) as HTMLInputElement;
    expect(dropdownSwitch.checked).toBe(false);

    act(() => {
      fireEvent.click(dropdownSwitch);
    });
    expect(dropdownSwitch.checked).toBe(true);

    // AI Copilot switch (Mặc định: false -> click để true)
    const aiCopilotSwitch = screen.getByLabelText(/Gợi ý sâu từ AI Copilot/i) as HTMLInputElement;
    expect(aiCopilotSwitch.checked).toBe(false);

    act(() => {
      fireEvent.click(aiCopilotSwitch);
    });
    expect(aiCopilotSwitch.checked).toBe(true);
  });

  it("AC2.1: Bộ chọn cỡ chữ (Font Size: 13px, 14px, 16px) hoạt động chính xác", () => {
    renderSettingsView("vi");

    const btn13 = screen.getByRole("radio", { name: "13px" });
    const btn14 = screen.getByRole("radio", { name: "14px" });
    const btn16 = screen.getByRole("radio", { name: "16px" });

    // Mặc định 14px
    expect(btn14.getAttribute("aria-checked")).toBe("true");
    expect(btn16.getAttribute("aria-checked")).toBe("false");

    // Chọn 16px
    act(() => {
      fireEvent.click(btn16);
    });
    expect(btn16.getAttribute("aria-checked")).toBe("true");
    expect(btn14.getAttribute("aria-checked")).toBe("false");

    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(stored.fontSize).toBe(16);

    // Chọn 13px
    act(() => {
      fireEvent.click(btn13);
    });
    expect(btn13.getAttribute("aria-checked")).toBe("true");
    const storedAfter = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(storedAfter.fontSize).toBe(13);
  });

  it("AC2.2: Lựa chọn Chủ đề Theme (Tối, Sáng, Hệ thống) hoạt động chính xác", () => {
    renderSettingsView("vi");

    const btnDark = screen.getByRole("radio", { name: /Tối/i });
    const btnLight = screen.getByRole("radio", { name: /Sáng/i });
    const btnAuto = screen.getByRole("radio", { name: /Hệ thống/i });

    // Mặc định Dark
    expect(btnDark.getAttribute("aria-checked")).toBe("true");

    // Chọn Sáng
    act(() => {
      fireEvent.click(btnLight);
    });
    expect(btnLight.getAttribute("aria-checked")).toBe("true");
    expect(btnDark.getAttribute("aria-checked")).toBe("false");

    let stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(stored.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Chọn Hệ thống
    act(() => {
      fireEvent.click(btnAuto);
    });
    expect(btnAuto.getAttribute("aria-checked")).toBe("true");
    stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(stored.theme).toBe("auto");
  });

  it("AC5 (Task114): Bật Tăng độ tương phản đồng bộ ngay lên document.documentElement", () => {
    renderSettingsView("vi");

    const contrastSwitch = screen.getByLabelText(/Chế độ tương phản cao/i) as HTMLInputElement;
    expect(contrastSwitch.checked).toBe(false);
    expect(document.documentElement.classList.contains("contrast-high")).toBe(false);
    expect(document.documentElement.getAttribute("data-contrast")).toBeNull();

    act(() => {
      fireEvent.click(contrastSwitch);
    });

    expect(contrastSwitch.checked).toBe(true);
    expect(document.documentElement.classList.contains("contrast-high")).toBe(true);
    expect(document.documentElement.getAttribute("data-contrast")).toBe("boost");

    // Click tắt lại
    act(() => {
      fireEvent.click(contrastSwitch);
    });

    expect(contrastSwitch.checked).toBe(false);
    expect(document.documentElement.classList.contains("contrast-high")).toBe(false);
    expect(document.documentElement.getAttribute("data-contrast")).toBeNull();
  });

  it("Nút Khôi phục mặc định reset lại toàn bộ cài đặt", () => {
    renderSettingsView("vi");

    const lineNumbersSwitch = screen.getByLabelText("Hiển thị số dòng") as HTMLInputElement;
    act(() => {
      fireEvent.click(lineNumbersSwitch);
    });
    expect(lineNumbersSwitch.checked).toBe(false);

    // Bấm nút Khôi phục mặc định
    const resetBtn = screen.getByRole("button", { name: /Khôi phục mặc định/i });
    act(() => {
      fireEvent.click(resetBtn);
    });

    // Sau khi reset, lineNumbers trở lại true
    expect(lineNumbersSwitch.checked).toBe(true);
    expect(screen.getByText("Đã khôi phục cài đặt mặc định")).toBeTruthy();
  });

  it("AC5: Hỗ trợ song ngữ Tiếng Anh (English locale) trơn tru", () => {
    renderSettingsView("en");

    expect(screen.getByRole("heading", { level: 1, name: "Settings & Preferences" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Workspace/i })).toBeTruthy();
    expect(screen.getByText("SQL Editor")).toBeTruthy();
    expect(screen.getByText("Appearance & Theme")).toBeTruthy();
    expect(screen.getByText("Code Completion & Smart Assistant")).toBeTruthy();
    expect(screen.getByText("Account & VIP Tier")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upgrade to VIP/i })).toBeTruthy();
  });

  it("AC5.1: Hiển thị chuẩn i18n cho tài khoản VIP ở cả tiếng Việt và tiếng Anh", () => {
    const vipUser = {
      id: "usr_vip",
      name: "VIP Dev",
      provider: "github",
      role: "vip" as const,
      isVip: true,
      vipUntil: "2027-12-31T00:00:00Z",
    };

    const mockAuth: Auth = {
      status: "user",
      user: vipUser,
      markAnon: vi.fn(),
      logout: vi.fn().mockResolvedValue(true),
      refreshUser: vi.fn().mockResolvedValue(undefined),
      banner: null,
      setBanner: vi.fn(),
      sqlRef: { current: "" },
    };

    // Test tiếng Việt
    const { unmount } = render(
      <NextIntlClientProvider locale="vi" messages={{ settings: settingsMessagesVi }}>
        <AuthContext.Provider value={mockAuth}>
          <SettingsProvider>
            <SettingsView />
          </SettingsProvider>
        </AuthContext.Provider>
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: "Gia hạn VIP" })).toBeTruthy();
    expect(screen.getByText(/Hạn dùng VIP:/i)).toBeTruthy();
    unmount();

    // Test tiếng Anh
    render(
      <NextIntlClientProvider locale="en" messages={{ settings: settingsMessagesEn }}>
        <AuthContext.Provider value={mockAuth}>
          <SettingsProvider>
            <SettingsView />
          </SettingsProvider>
        </AuthContext.Provider>
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: "Extend VIP" })).toBeTruthy();
    expect(screen.getByText(/VIP until:/i)).toBeTruthy();
  });
});
