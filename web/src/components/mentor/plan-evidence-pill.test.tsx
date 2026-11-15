import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import mentorMessages from "../../../messages/en/mentor.json";
import {
  PlanEvidencePill,
  PLAN_EVIDENCE_STORAGE_KEY,
} from "./plan-evidence-pill";

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages }}>
      {ui}
    </NextIntlClientProvider>
  );

describe("PlanEvidencePill Component", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("AC1: hiển thị trạng thái Kèm Plan sáng xanh khi engine là PostgreSQL và isAttached = true", () => {
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={true}
        isMeasuring={false}
        onToggle={vi.fn()}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill).toBeDefined();
    expect(pill.getAttribute("role")).toBe("switch");
    expect(pill.getAttribute("aria-checked")).toBe("true");
    expect(pill.textContent).toContain("Plan Attached (~40 tokens)");
  });

  test("AC1: hiển thị trạng thái Plan: Tắt xám mờ khi isAttached = false", () => {
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={false}
        isMeasuring={false}
        onToggle={vi.fn()}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill.getAttribute("role")).toBe("switch");
    expect(pill.getAttribute("aria-checked")).toBe("false");
    expect(pill.textContent).toContain("Plan: Off");
  });

  test("AC1: click toggle chuyển đổi trạng thái và ghi vào localStorage", () => {
    const onToggleMock = vi.fn();
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={true}
        isMeasuring={false}
        onToggle={onToggleMock}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    fireEvent.click(pill);

    expect(onToggleMock).toHaveBeenCalledWith(false);
    expect(window.localStorage.getItem(PLAN_EVIDENCE_STORAGE_KEY)).toBe("false");
  });

  test("AC1: hỗ trợ phím Space và Enter để toggle khả năng tiếp cận", () => {
    const onToggleMock = vi.fn();
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={false}
        isMeasuring={false}
        onToggle={onToggleMock}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    fireEvent.keyDown(pill, { key: " " });
    expect(onToggleMock).toHaveBeenCalledWith(true);

    fireEvent.keyDown(pill, { key: "Enter" });
    expect(onToggleMock).toHaveBeenCalledWith(true);

    // Phím khác không kích hoạt
    onToggleMock.mockClear();
    fireEvent.keyDown(pill, { key: "Tab" });
    expect(onToggleMock).not.toHaveBeenCalled();
  });

  test("AC1: hiển thị spinner khi isMeasuring = true và vô hiệu hóa toggle", () => {
    const onToggleMock = vi.fn();
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={true}
        isMeasuring={true}
        onToggle={onToggleMock}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.textContent).toContain("Measuring...");

    fireEvent.click(pill);
    expect(onToggleMock).not.toHaveBeenCalled();
  });

  test("AC3: engine là MySQL hiển thị thông báo hướng dẫn bấm nút phân tích và chặn toggle", () => {
    const onToggleMock = vi.fn();
    wrap(
      <PlanEvidencePill
        engine="mysql"
        isAttached={false}
        isMeasuring={false}
        onToggle={onToggleMock}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.textContent).toContain("MySQL: Click button to analyze");

    fireEvent.click(pill);
    expect(onToggleMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PLAN_EVIDENCE_STORAGE_KEY)).toBeNull();
  });

  test("ca biên: an toàn không crash khi localStorage bị chặn", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied for this document");
    });

    const onToggleMock = vi.fn();
    wrap(
      <PlanEvidencePill
        engine="postgres"
        isAttached={true}
        isMeasuring={false}
        onToggle={onToggleMock}
      />
    );

    const pill = screen.getByTestId("plan-evidence-pill");
    expect(() => fireEvent.click(pill)).not.toThrow();
    expect(onToggleMock).toHaveBeenCalledWith(false);

    setItemSpy.mockRestore();
  });
});
