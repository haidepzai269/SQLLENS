import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/share.json";
import messagesVi from "../../../../messages/vi/share.json";
import { ForkError } from "../fork";
import type { SnapshotV1 } from "../snapshot";
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
  const messages = { share: locale === "vi" ? messagesVi : messagesEn };
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
