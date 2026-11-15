import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import mentorMessages from "../../../messages/en/mentor.json";
import { QuickActionChips } from "./quick-action-chips";

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages }}>
      {ui}
    </NextIntlClientProvider>
  );

describe("QuickActionChips Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("AC2: render đầy đủ cụm 3 quick-action chips với text i18n", () => {
    wrap(<QuickActionChips onTrigger={vi.fn()} isPlanReady={true} />);

    expect(screen.getByTestId("quick-action-chips")).toBeDefined();

    const slowChip = screen.getByTestId("chip-slow");
    expect(slowChip).toBeDefined();
    expect(slowChip.textContent).toBe("⚡ Why is this query slow?");

    const indexChip = screen.getByTestId("chip-index");
    expect(indexChip).toBeDefined();
    expect(indexChip.textContent).toBe("🔍 Is the optimizer using an Index?");

    const buffersChip = screen.getByTestId("chip-buffers");
    expect(buffersChip).toBeDefined();
    expect(buffersChip.textContent).toBe("📊 How many memory buffers are read?");
  });

  test("AC2: click vào chip gọi onTrigger với đúng nội dung prompt", () => {
    const onTriggerMock = vi.fn();
    wrap(<QuickActionChips onTrigger={onTriggerMock} isPlanReady={true} />);

    // Click chip 1: Slow query
    fireEvent.click(screen.getByTestId("chip-slow"));
    expect(onTriggerMock).toHaveBeenCalledTimes(1);
    expect(onTriggerMock).toHaveBeenCalledWith("⚡ Why is this query slow?");

    // Click chip 2: Index usage
    fireEvent.click(screen.getByTestId("chip-index"));
    expect(onTriggerMock).toHaveBeenCalledTimes(2);
    expect(onTriggerMock).toHaveBeenCalledWith("🔍 Is the optimizer using an Index?");

    // Click chip 3: Memory buffers
    fireEvent.click(screen.getByTestId("chip-buffers"));
    expect(onTriggerMock).toHaveBeenCalledTimes(3);
    expect(onTriggerMock).toHaveBeenCalledWith("📊 How many memory buffers are read?");
  });

  test("AC2: chống spam - vô hiệu hóa khi disabled = true hoặc isBusy = true", () => {
    const onTriggerMock = vi.fn();
    const { rerender } = wrap(
      <QuickActionChips
        onTrigger={onTriggerMock}
        disabled={true}
        isPlanReady={false}
      />
    );

    const slowChip = screen.getByTestId("chip-slow") as HTMLButtonElement;
    expect(slowChip.disabled).toBe(true);
    fireEvent.click(slowChip);
    expect(onTriggerMock).not.toHaveBeenCalled();

    // Trường hợp isBusy = true
    rerender(
      <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages }}>
        <QuickActionChips
          onTrigger={onTriggerMock}
          disabled={false}
          isBusy={true}
          isPlanReady={true}
        />
      </NextIntlClientProvider>
    );

    const indexChip = screen.getByTestId("chip-index") as HTMLButtonElement;
    expect(indexChip.disabled).toBe(true);
    fireEvent.click(indexChip);
    expect(onTriggerMock).not.toHaveBeenCalled();
  });
});
