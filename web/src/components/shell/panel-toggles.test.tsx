import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import shellMessagesVi from "../../../messages/vi/shell.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellProvider } from "./shell-provider";
import { PanelToggles } from "./panel-toggles";

const mockPush = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockPush.mockClear();
});

describe("PanelToggles (Task105)", () => {
  it("AC1: Dropdown menu hiển thị danh sách vùng layout và mục Cài đặt nâng cao điều hướng sang /settings", async () => {
    render(
      <NextIntlClientProvider locale="vi" messages={{ shell: shellMessagesVi }}>
        <TooltipProvider>
          <ShellProvider>
            <PanelToggles />
          </ShellProvider>
        </TooltipProvider>
      </NextIntlClientProvider>
    );

    // Tìm nút bánh răng Trigger
    const trigger = screen.getByRole("button", { name: "Bố cục: bật tắt các vùng" });
    expect(trigger).toBeTruthy();

    // Mở dropdown
    act(() => {
      fireEvent.click(trigger);
    });

    // Kiểm tra 4 vùng hiển thị đầy đủ
    expect(screen.getByText("Cột SQL")).toBeTruthy();
    expect(screen.getByText("Vùng mô phỏng")).toBeTruthy();
    expect(screen.getByText("Cột rủi ro")).toBeTruthy();
    expect(screen.getByText("Terminal")).toBeTruthy();

    // Kiểm tra mục "Cài đặt nâng cao..."
    const advancedItem = screen.getByText("Cài đặt nâng cao...");
    expect(advancedItem).toBeTruthy();

    // Click "Cài đặt nâng cao..."
    act(() => {
      fireEvent.click(advancedItem);
    });

    // Kiểm tra router.push được gọi với /settings
    expect(mockPush).toHaveBeenCalledWith("/settings");
  });
});
