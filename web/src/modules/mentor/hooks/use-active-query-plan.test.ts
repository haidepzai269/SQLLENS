import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as safeExplainModule from "@/engines/postgres/safe-explain";
import { useActiveQueryPlan } from "./use-active-query-plan";

describe("useActiveQueryPlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockRun = vi.fn().mockResolvedValue([]);

  it("trả về planEvidence = null khi editorContent rỗng", () => {
    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: "",
        cursorOffset: 0,
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();
    expect(result.current.isMeasuring).toBe(false);
  });

  it("trả về planEvidence = null khi isEnabled = false", () => {
    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: "SELECT * FROM users",
        cursorOffset: 5,
        isEnabled: false,
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();
    expect(result.current.isMeasuring).toBe(false);
  });

  it("AC4: trả về planEvidence = null khi engine là mysql (chống tự động chạy ngầm trên MySQL Sandbox)", () => {
    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: "SELECT * FROM users",
        cursorOffset: 5,
        engine: "mysql",
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();
    expect(result.current.isMeasuring).toBe(false);
  });

  it("AC6: bỏ qua câu lệnh không thuộc EXPLAINABLE (ví dụ CREATE TABLE)", () => {
    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: "CREATE TABLE demo(id int);",
        cursorOffset: 5,
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();
    expect(result.current.isMeasuring).toBe(false);
  });

  it("ưu tiên dùng selection khi người dùng bôi đen đoạn mã", async () => {
    const spyExplain = vi.spyOn(safeExplainModule, "runSafeExplainAnalyze").mockResolvedValue({
      planEvidence: "[PLAN_EVIDENCE: Seq Scan on orders]",
      rawJson: {},
    });

    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: "SELECT * FROM users; SELECT * FROM orders;",
        cursorOffset: 5, // Trỏ vào users
        selection: "SELECT * FROM orders", // Nhưng bôi đen orders
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();

    // Kích hoạt debounce 300ms
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(spyExplain).toHaveBeenCalledWith(mockRun, "SELECT * FROM orders", 1500);
    expect(result.current.planEvidence).toBe("[PLAN_EVIDENCE: Seq Scan on orders]");
    expect(result.current.isMeasuring).toBe(false);
  });

  it("debounce 300ms tự động trích xuất statement tại cursor và sinh planEvidence", async () => {
    const spyExplain = vi.spyOn(safeExplainModule, "runSafeExplainAnalyze").mockResolvedValue({
      planEvidence: "[PLAN_EVIDENCE: Index Scan on users using users_pkey | Actual Rows: 1]",
      rawJson: { Plan: { "Node Type": "Index Scan" } },
    });

    const script = "SELECT * FROM users WHERE id = 1;\nSELECT * FROM logs;";
    const { result } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: script,
        cursorOffset: 10,
        run: mockRun,
      })
    );

    expect(result.current.planEvidence).toBeNull();
    expect(spyExplain).not.toHaveBeenCalled();

    // Chờ 200ms (chưa đủ debounce)
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spyExplain).not.toHaveBeenCalled();

    // Chờ thêm 100ms (tổng 300ms)
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(spyExplain).toHaveBeenCalledWith(mockRun, "SELECT * FROM users WHERE id = 1", 1500);
    expect(result.current.planEvidence).toBe(
      "[PLAN_EVIDENCE: Index Scan on users using users_pkey | Actual Rows: 1]"
    );
    expect(result.current.isMeasuring).toBe(false);
  });

  it("hủy lệnh cũ khi query thay đổi liên tục trước debounce (Debounce Cancellation)", async () => {
    const spyExplain = vi.spyOn(safeExplainModule, "runSafeExplainAnalyze").mockResolvedValue({
      planEvidence: "[PLAN_EVIDENCE: Seq Scan on products]",
    });

    let currentSql = "SELECT * FROM table_1";
    const { rerender } = renderHook(() =>
      useActiveQueryPlan({
        editorContent: currentSql,
        cursorOffset: 0,
        run: mockRun,
      })
    );

    // Chờ 150ms rồi đổi query
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    currentSql = "SELECT * FROM products";
    rerender();

    // Chờ 150ms nữa (lúc này câu đầu tiên nếu không bị hủy sẽ chạy ở mốc 300ms)
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Chưa đủ 300ms cho câu thứ hai, câu đầu tiên đã bị cancel
    expect(spyExplain).not.toHaveBeenCalled();

    // Chờ thêm 150ms để câu thứ hai đủ 300ms
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(spyExplain).toHaveBeenCalledTimes(1);
    expect(spyExplain).toHaveBeenCalledWith(mockRun, "SELECT * FROM products", 1500);
  });
});
