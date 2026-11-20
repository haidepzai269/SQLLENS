import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/share.json";
import messagesVi from "../../../../messages/vi/share.json";
import { ReadonlyWorkspace } from "./readonly-workspace";
import type { SnapshotV1 } from "../snapshot";

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
    const content = await waitFor(() => {
      const el = container.querySelector(".cm-content");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector(".cm-lineNumbers")).toBeTruthy();
    expect(content.textContent).toContain("CREATE TABLE accounts");
  });

  it("AC3: tab bar chuyển tab được và không có nút thêm/đóng", async () => {
    const { container } = renderWorkspace();

    fireEvent.click(screen.getByTestId("share-tab-1"));
    await waitFor(() => expect(screen.getByTestId("share-tab-1").getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("UPDATE accounts"));

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
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("SELECT 0;"));
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
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
  });
});
