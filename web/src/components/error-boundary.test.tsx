import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StageErrorBoundary } from "./error-boundary";
import { NextIntlClientProvider } from "next-intl";

afterEach(cleanup);

const messages = {
  labStage: {
    errorBoundary: {
      title: "Lỗi hiển thị tại cảnh này",
      retry: "Thử lại",
      description: "Đã xảy ra ngoại lệ khi vẽ giao diện của tab này.",
    },
  },
};

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Lỗi giả lập khi render tab");
  }
  return <div>Nội dung bình thường</div>;
}

describe("StageErrorBoundary", () => {
  it("bắt ngoại lệ và hiển thị alert lỗi kèm nút Thử lại, không làm sập ứng dụng", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const onReset = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="vi" messages={messages}>
        <StageErrorBoundary onReset={onReset}>
          <Bomb shouldThrow={true} />
        </StageErrorBoundary>
      </NextIntlClientProvider>
    );

    // Kiểm tra alert lỗi hiển thị
    const alert = screen.getByTestId("stage-error-boundary");
    expect(alert).toBeTruthy();
    expect(screen.getByText("Lỗi giả lập khi render tab")).toBeTruthy();

    // Bấm nút "Thử lại"
    const retryBtn = screen.getByTestId("stage-error-retry");
    expect(retryBtn).toBeTruthy();

    // Rerender với component không throw nữa
    rerender(
      <NextIntlClientProvider locale="vi" messages={messages}>
        <StageErrorBoundary onReset={onReset}>
          <Bomb shouldThrow={false} />
        </StageErrorBoundary>
      </NextIntlClientProvider>
    );

    fireEvent.click(retryBtn);
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByText("Nội dung bình thường")).toBeTruthy();

    consoleError.mockRestore();
  });
});
