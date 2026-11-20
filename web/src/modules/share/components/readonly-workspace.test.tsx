import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/share.json";
import messagesVi from "../../../../messages/vi/share.json";
import messagesCommonEn from "../../../../messages/en/common.json";
import messagesCommonVi from "../../../../messages/vi/common.json";
import messagesGuardEn from "../../../../messages/en/guard.json";
import messagesGuardVi from "../../../../messages/vi/guard.json";
import { ForkError } from "../fork";
import type { SnapshotV1 } from "../snapshot";
import { SnapshotRunError, type SnapshotRunOutcome } from "../try-run";
import { ReadonlyWorkspace } from "./readonly-workspace";

// Fork đi qua IndexedDB thật và /api/me, nên test giao diện chỉ kiểm phần nối dây:
// bấm nút -> gọi forkSnapshot đúng tham số -> báo toast -> điều hướng.
const navMock = vi.hoisted(() => ({ push: vi.fn() }));
const forkMock = vi.hoisted(() => ({
  forkSnapshot: vi.fn(),
  hasForkedSnapshot: vi.fn(() => false),
  resolveWorkspaceScope: vi.fn(async () => ({ kind: "guest" as const })),
  snapshotFingerprint: vi.fn(() => "fp-1"),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
// Chạy thử: engine thật chỉ có trong trình duyệt, nên test giao diện thay `runSnapshotTab`.
const runMock = vi.hoisted(() => ({ runSnapshotTab: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: navMock.push, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("../fork", () => ({
  ForkError: class ForkError extends Error {
    readonly code: string;
    constructor(code = "FORK_FAILED") {
      super(code);
      this.name = "ForkError";
      this.code = code;
    }
  },
  forkSnapshot: forkMock.forkSnapshot,
  hasForkedSnapshot: forkMock.hasForkedSnapshot,
  resolveWorkspaceScope: forkMock.resolveWorkspaceScope,
  snapshotFingerprint: forkMock.snapshotFingerprint,
}));

vi.mock("../try-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../try-run")>();
  return { ...actual, runSnapshotTab: runMock.runSnapshotTab };
});

vi.mock("sonner", () => ({ toast: toastMock }));

beforeAll(() => {
  // jsdom không có layout; CodeMirror chỉ cần hai hàm này để dựng view.
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () =>
      ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  }
});

function snapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    v: 1,
    project: { name: "E-Commerce Deadlock Test", engine: "postgres" },
    tabs: [
      { name: "01_schema.sql", sql: "CREATE TABLE accounts (id serial primary key);" },
      { name: "02_deadlock_sim.sql", sql: "BEGIN;\nUPDATE accounts SET balance = 0 WHERE id = 1;" },
    ],
    ...overrides,
  };
}

function renderWorkspace(data: SnapshotV1 = snapshot(), locale: "vi" | "en" = "vi") {
  // `common` cho nhãn kết luận, `guard` cho câu giải thích rào chắn (dùng chung với phòng lab).
  const messagesCommon = locale === "vi" ? messagesCommonVi : messagesCommonEn;
  const messages = {
    share: locale === "vi" ? messagesVi : messagesEn,
    common: { conclusionLabels: messagesCommon.conclusionLabels },
    guard: locale === "vi" ? messagesGuardVi : messagesGuardEn,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ReadonlyWorkspace snapshot={data} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReadonlyWorkspace (Task146)", () => {
  it("AC1: header đúng prototype — logo, badge chỉ đọc, tên dự án, nhãn engine", async () => {
    renderWorkspace();

    expect(screen.getByTestId("readonly-badge").textContent).toContain(messagesVi.view.badge);
    expect(screen.getByTestId("share-project-name").textContent).toBe("E-Commerce Deadlock Test");
    expect(screen.getByText("PostgreSQL")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: messagesVi.view.tabsLabel })).toBeTruthy();
  });

  it("AC2: editor không gõ được nhưng vẫn chọn/copy được nội dung", async () => {
    const { container } = renderWorkspace();
    // CodeMirror được tải lười; khi cả bộ test chạy song song, đoạn chunk có thể quá 1 giây.
    const content = await waitFor(
      () => {
        const el = container.querySelector(".cm-content");
        expect(el).toBeTruthy();
        return el as HTMLElement;
      },
      { timeout: 5_000 },
    );

    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector(".cm-lineNumbers")).toBeTruthy();
    expect(content.textContent).toContain("CREATE TABLE accounts");
  });

  it("AC3: tab bar chuyển tab được và không có nút thêm/đóng", async () => {
    const { container } = renderWorkspace();

    fireEvent.click(screen.getByTestId("share-tab-1"));
    await waitFor(() => expect(screen.getByTestId("share-tab-1").getAttribute("aria-selected")).toBe("true"));
    await waitFor(
      () => expect(container.querySelector(".cm-content")?.textContent).toContain("UPDATE accounts"),
      { timeout: 5_000 },
    );

    expect(screen.queryByTestId("tab-add-btn")).toBeNull();
    expect(container.querySelector('[aria-label="Đóng tab"]')).toBeNull();
  });

  it("AC4: nút Sao chép SQL copy đúng tab đang mở và báo đã sao chép", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-copy-sql"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snapshot().tabs[0].sql));
    await waitFor(() => expect(screen.getByTestId("share-toast").textContent).toContain(messagesVi.view.copied));
  });

  it("AC4 ca biên: clipboard bị chặn thì báo lỗi thay vì im lặng", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) } });
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => false), configurable: true });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-copy-sql"));
    await waitFor(() => expect(screen.getByTestId("share-toast").textContent).toContain(messagesVi.view.copyFailed));
  });

  it("ca biên: snapshot 1 tab, tên tab dài vẫn cắt gọn có tooltip, SQL 500 dòng không vỡ", async () => {
    const longName = "mot_ten_tab_rat_dai_" + "x".repeat(120) + ".sql";
    const manyLines = Array.from({ length: 500 }, (_, i) => `SELECT ${i};`).join("\n");
    renderWorkspace(snapshot({ tabs: [{ name: longName, sql: manyLines }] }));

    const tab = screen.getByTestId("share-tab-0");
    expect(tab.getAttribute("title")).toBe(longName);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByTestId("tab-add-btn")).toBeNull();
    // CodeMirror chỉ dựng các dòng trong khung nhìn; đủ để thấy tài liệu 500 dòng đã nạp.
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("SELECT 0;"), {
      timeout: 5_000,
    });
    expect(document.querySelector(".cm-scroller")).toBeTruthy();
  });

  it("ca biên: snapshot không có tab và tab rỗng đều có lời giải thích", async () => {
    renderWorkspace(snapshot({ tabs: [] }));
    expect(screen.getByText(messagesVi.view.noTabs)).toBeTruthy();

    cleanup();
    renderWorkspace(snapshot({ tabs: [{ name: "empty.sql", sql: "  " }] }));
    expect(screen.getByText(messagesVi.view.emptyTab)).toBeTruthy();
  });

  it("AC5: bản tiếng Anh đủ nhãn, 1 tab, engine MySQL", async () => {
    const { container } = renderWorkspace(snapshot({ project: { name: "Shop", engine: "mysql" } }), "en");

    expect(screen.getByTestId("readonly-badge").textContent).toContain(messagesEn.view.badge);
    expect(screen.getByText("MySQL")).toBeTruthy();
    expect(screen.getByText(messagesEn.view.copy)).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy(), { timeout: 5_000 });
  });
});

describe("ReadonlyWorkspace — Fork (Task147)", () => {
  beforeEach(() => {
    navMock.push.mockClear();
    toastMock.success.mockClear();
    forkMock.hasForkedSnapshot.mockReset().mockReturnValue(false);
    forkMock.resolveWorkspaceScope.mockClear();
    forkMock.forkSnapshot.mockReset();
    forkMock.snapshotFingerprint.mockClear();
  });

  it("AC2: bấm Fork ghi đúng scope rồi điều hướng về workspace kèm thông báo số tab", async () => {
    forkMock.forkSnapshot.mockResolvedValue({ projectId: "p1", tabs: 2 });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-fork-btn"));

    await waitFor(() => expect(forkMock.forkSnapshot).toHaveBeenCalledTimes(1));
    const [snapArg, scopeArg, options] = forkMock.forkSnapshot.mock.calls[0] as [
      SnapshotV1,
      { kind: string },
      { suffix: string },
    ];
    expect(snapArg).toEqual(snapshot());
    expect(scopeArg).toEqual({ kind: "guest" });
    expect(options.suffix).toBe(messagesVi.view.forkSuffix);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("2")));
    expect(navMock.push).toHaveBeenCalledWith("/");
    // AC4: snapshot trong URL không đổi sau khi fork.
    expect(window.location.hash).toBe("");
  });

  it("AC3: lần fork thứ hai hỏi lại; chưa xác nhận thì chưa nhân bản", async () => {
    forkMock.hasForkedSnapshot.mockReturnValue(true);
    forkMock.forkSnapshot.mockResolvedValue({ projectId: "p2", tabs: 2 });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-fork-btn"));

    await waitFor(() => expect(screen.getByTestId("share-fork-confirm")).toBeTruthy());
    expect(forkMock.forkSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("share-fork-confirm-btn"));
    await waitFor(() => expect(forkMock.forkSnapshot).toHaveBeenCalledTimes(1));
  });

  it("AC6: nút Fork có bản tiếng Anh", () => {
    renderWorkspace(snapshot(), "en");
    expect(screen.getByTestId("share-fork-btn").textContent).toContain(messagesEn.view.fork);
  });

  it("lỗi lưu trữ hiện thông báo rõ, không điều hướng và không im lặng", async () => {
    forkMock.forkSnapshot.mockRejectedValue(new ForkError("FORK_QUOTA_EXCEEDED", "đầy"));
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-fork-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("share-fork-error").textContent).toContain(messagesVi.view.forkErrorQuota),
    );
    expect(navMock.push).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("ReadonlyWorkspace — Chạy thử (Task148)", () => {
  const RESULT: SnapshotRunOutcome = {
    kind: "result",
    label: "real",
    statements: 2,
    fields: ["id", "name"],
    rows: [
      [1, "an"],
      [2, "bình"],
    ],
    totalRows: 2,
    truncated: false,
    affectedRows: undefined,
  };

  beforeEach(() => {
    runMock.runSnapshotTab.mockReset();
  });

  it("AC1: bấm Chạy gọi runner với tab đang mở, engine của snapshot và SQL các tab trước", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    await waitFor(() => expect(runMock.runSnapshotTab).toHaveBeenCalledTimes(1));
    const [tabArg, engineArg, options] = runMock.runSnapshotTab.mock.calls[0] as [
      { name: string; sql: string },
      string,
      { setupSql: string; signal: AbortSignal },
    ];
    expect(tabArg).toEqual(snapshot().tabs[0]);
    expect(engineArg).toBe("postgres");
    expect(options.setupSql).toBe(""); // tab đầu: không có tab nào phía trước
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("AC1: kết quả hiện bảng, số câu và nhãn Thật (không phải Mô phỏng/Ước lượng)", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const result = await screen.findByTestId("share-run-result");
    expect(result.textContent).toContain("an");
    expect(result.textContent).toContain("bình");
    expect(screen.getByTestId("share-run-panel").getAttribute("data-phase")).toBe("done");

    const label = screen.getByTestId("share-run-label");
    expect(label.getAttribute("data-label")).toBe("real");
    // Nhãn phải là chữ "Thật" lấy từ common.conclusionLabels, không phải nhãn khác.
    expect(label.textContent).toBe("Thật");
    expect(screen.getByTestId("share-run-panel").textContent).not.toContain("Mô phỏng");
    expect(screen.getByTestId("share-run-panel").textContent).not.toContain("Ước lượng");
  });

  it("AC2: tab thứ hai chạy kèm SQL của tab đầu để có bảng", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-tab-1"));
    fireEvent.click(screen.getByTestId("share-run-btn"));

    await waitFor(() => expect(runMock.runSnapshotTab).toHaveBeenCalledTimes(1));
    const [, , options] = runMock.runSnapshotTab.mock.calls[0] as [unknown, string, { setupSql: string }];
    expect(options.setupSql).toBe("CREATE TABLE accounts (id serial primary key);");
  });

  it("AC3: snapshot MySQL báo cần sandbox, không gọi mạng", async () => {
    runMock.runSnapshotTab.mockResolvedValue({ kind: "needs_sandbox", engine: "mysql" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWorkspace(snapshot({ project: { name: "Shop", engine: "mysql" } }));

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-sandbox");
    expect(box.textContent).toContain(messagesVi.view.runNeedsSandboxBody);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AC5: đang chạy có nút Hủy; bấm Hủy abort signal của lượt đó", async () => {
    let resolveRun: (v: SnapshotRunOutcome) => void = () => {};
    runMock.runSnapshotTab.mockImplementation(
      (_tab: unknown, _engine: string, options: { signal: AbortSignal }) =>
        new Promise<SnapshotRunOutcome>((resolve) => {
          resolveRun = resolve;
          options.signal.addEventListener("abort", () => resolve({ kind: "empty" }));
        }),
    );
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));
    const cancel = await screen.findByTestId("share-run-cancel");
    expect(screen.getByTestId("share-run-panel").getAttribute("data-phase")).toBe("busy");

    const [, , options] = runMock.runSnapshotTab.mock.calls[0] as [unknown, string, { signal: AbortSignal }];
    expect(options.signal.aborted).toBe(false);
    fireEvent.click(cancel);
    expect(options.signal.aborted).toBe(true);
    resolveRun(RESULT);
  });

  it("AC5: quá hạn hiện thông điệp 1.500 ms, không đóng băng", async () => {
    runMock.runSnapshotTab.mockRejectedValue(new SnapshotRunError("timeout", "No response after 1500 ms"));
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-error");
    expect(box.textContent).toContain(messagesVi.view.runTimeout);
    expect(screen.getByTestId("share-run-panel").getAttribute("data-phase")).toBe("error");
  });

  it("AC5: hủy chủ động hiện đúng thông điệp đã hủy", async () => {
    runMock.runSnapshotTab.mockRejectedValue(new SnapshotRunError("cancelled", "Đã hủy"));
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-error");
    expect(box.textContent).toContain(messagesVi.view.runCancelled);
  });

  it("lỗi SQL hiện thông điệp engine kèm số câu", async () => {
    runMock.runSnapshotTab.mockRejectedValue(
      new SnapshotRunError("sql", 'relation "accounts" does not exist', 15, undefined, 2),
    );
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-error");
    expect(box.textContent).toContain('relation "accounts" does not exist');
    expect(box.textContent).toContain(messagesVi.view.runStatementAt.replace("{n}", "2"));
  });

  it("rào chắn chặn câu thì tiêu đề nói rõ là bị chặn, không phải lỗi SQL", async () => {
    runMock.runSnapshotTab.mockRejectedValue(
      new SnapshotRunError("guard", "blocked", undefined, "guard.sqlite.attach"),
    );
    renderWorkspace(snapshot({ project: { name: "S", engine: "sqlite" } }));

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-error");
    expect(box.textContent).toContain(messagesVi.view.runGuardTitle);
    // Review vòng 1: lý do chặn phải là câu giải thích đã dịch, không phải chuỗi thô của engine.
    expect(box.textContent).toContain(messagesGuardVi.sqlite.attach);
    expect(box.textContent).not.toContain("blocked");
    // Dòng trạng thái ở tiêu đề panel phải cùng ý với tiêu đề trong phần thân.
    expect(screen.getByTestId("share-run-panel").textContent).toContain(messagesVi.view.runGuardTitle);
    expect(screen.getByTestId("share-run-panel").textContent).not.toContain(messagesVi.view.runFailedTitle);
  });

  it("rào chắn Postgres hiện câu giải thích role đã dịch kèm số câu", async () => {
    runMock.runSnapshotTab.mockRejectedValue(
      new SnapshotRunError("guard", "Statement 1 blocked (guard.role)", undefined, "guard.role", 1),
    );
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const box = await screen.findByTestId("share-run-error");
    expect(box.textContent).toContain(messagesGuardVi.role.replace("{index}", "1"));
    expect(box.textContent).not.toContain("guard.role");
  });

  it("AC6: kết quả không ghi vào URL; đổi tab thì ẩn kết quả cũ", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace();
    const hashBefore = window.location.hash;

    fireEvent.click(screen.getByTestId("share-run-btn"));
    await screen.findByTestId("share-run-result");
    expect(window.location.hash).toBe(hashBefore);

    fireEvent.click(screen.getByTestId("share-tab-1"));
    await waitFor(() => expect(screen.queryByTestId("share-run-result")).toBeNull());
    expect(screen.getByTestId("share-run-panel").getAttribute("data-phase")).toBe("idle");
  });

  it("đổi tab giữa lúc chạy thì dừng lượt cũ, kết quả về muộn không rơi vào tab mới", async () => {
    let resolveRun: (v: SnapshotRunOutcome) => void = () => {};
    runMock.runSnapshotTab.mockImplementation(
      (_tab: unknown, _engine: string, options: { signal: AbortSignal }) =>
        new Promise<SnapshotRunOutcome>((resolve) => {
          resolveRun = resolve;
          options.signal.addEventListener("abort", () => resolve({ kind: "empty" }));
        }),
    );
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));
    await screen.findByTestId("share-run-cancel");
    const [, , options] = runMock.runSnapshotTab.mock.calls[0] as [unknown, string, { signal: AbortSignal }];

    fireEvent.click(screen.getByTestId("share-tab-1"));
    expect(options.signal.aborted).toBe(true);

    // Kể cả khi lượt cũ tự trả kết quả (engine không nghe abort kịp), tab mới không được hiện nó.
    resolveRun(RESULT);
    await waitFor(() => expect(screen.getByTestId("share-run-panel").getAttribute("data-phase")).toBe("idle"));
    expect(screen.queryByTestId("share-run-result")).toBeNull();
  });

  it("AC6: nút Ẩn kết quả dọn vùng kết quả", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));
    await screen.findByTestId("share-run-result");
    fireEvent.click(screen.getByTestId("share-run-close"));

    expect(screen.queryByTestId("share-run-result")).toBeNull();
  });

  it("ca biên: kết quả 100k dòng chia trang, chỉ dựng 100 dòng mỗi trang", async () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => [i, `row-${i}`]);
    runMock.runSnapshotTab.mockResolvedValue({
      kind: "result",
      label: "real",
      statements: 1,
      fields: ["id", "name"],
      rows,
      totalRows: 100_000,
      truncated: true,
      affectedRows: undefined,
    });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const result = await screen.findByTestId("share-run-result");
    expect(result.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(result.textContent).toContain(messagesVi.view.runTruncated.replace("{max}", "2000").replace("{total}", "100000"));
    expect(screen.getByTestId("share-run-page").textContent).toContain("1/20");

    fireEvent.click(screen.getByTestId("share-run-next"));
    await waitFor(() => expect(screen.getByTestId("share-run-page").textContent).toContain("2/20"));
    expect(result.textContent).toContain("row-100");
  });

  it("ca biên: DDL không trả dòng vẫn có thông điệp rõ ràng", async () => {
    runMock.runSnapshotTab.mockResolvedValue({
      kind: "result",
      label: "real",
      statements: 1,
      fields: [],
      rows: [],
      totalRows: 0,
      truncated: false,
      affectedRows: 0,
    });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("share-run-btn"));

    const result = await screen.findByTestId("share-run-result");
    expect(result.textContent).toContain(messagesVi.view.runAffected.replace("{count}", "0"));
  });

  it("ca biên: tab rỗng báo không có gì để chạy", async () => {
    runMock.runSnapshotTab.mockResolvedValue({ kind: "empty" });
    renderWorkspace(snapshot({ tabs: [{ name: "empty.sql", sql: "  " }] }));

    fireEvent.click(screen.getByTestId("share-run-btn"));

    expect((await screen.findByTestId("share-run-empty")).textContent).toContain(messagesVi.view.runEmptyBody);
  });

  it("AC7: đủ bản tiếng Anh cho nút Chạy và vùng kết quả", async () => {
    runMock.runSnapshotTab.mockResolvedValue(RESULT);
    renderWorkspace(snapshot(), "en");

    expect(screen.getByTestId("share-run-btn").textContent).toContain(messagesEn.view.run);
    fireEvent.click(screen.getByTestId("share-run-btn"));

    await screen.findByTestId("share-run-result");
    // Số câu nằm ở dòng trạng thái của panel, bảng ở phần thân.
    expect(screen.getByTestId("share-run-panel").textContent).toContain(
      messagesEn.view.runStatements.replace("{count}", "2"),
    );
    expect(screen.getByTestId("share-run-label").textContent).toBe(messagesCommonEn.conclusionLabels.real.name);
  });
});
