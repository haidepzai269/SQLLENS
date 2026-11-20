import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../messages/en/share.json";
import messagesVi from "../../../messages/vi/share.json";
import { bytesToBase64Url, encodeSnapshot } from "./codec";
import { extractPayload, ShareView } from "./share-view";
import type { SnapshotV1 } from "./snapshot";

// Vite không phân giải được `next/navigation` qua junction node_modules; test chỉ cần một thẻ a.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderView(locale: "vi" | "en" = "vi") {
  const messages = { share: locale === "vi" ? messagesVi : messagesEn };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ShareView />
    </NextIntlClientProvider>,
  );
}

function setHash(hash: string) {
  window.location.hash = hash;
}

async function snapshotPayload(snapshot: SnapshotV1 = baseSnapshot()) {
  return encodeSnapshot(snapshot);
}

function baseSnapshot(): SnapshotV1 {
  return {
    v: 1,
    project: { name: "Dự án Bán hàng", engine: "postgres" },
    tabs: [
      { name: "01_schema.sql", sql: "CREATE TABLE orders (id int);" },
      { name: "02_query.sql", sql: "SELECT * FROM orders;" },
    ],
  };
}

/** Payload không nén hợp lệ cho mọi phiên bản, để thử nhánh "version khác". */
function rawPayload(value: unknown): string {
  return "u." + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

beforeAll(() => {
  // Snapshot hợp lệ render CodeMirror; jsdom cần hai hàm layout tối thiểu để dựng view.
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () =>
      ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  }
});

afterEach(() => {
  cleanup();
  setHash("");
  vi.restoreAllMocks();
});

describe("extractPayload", () => {
  it("trả null khi không có hash hoặc hash không có d", () => {
    expect(extractPayload("")).toBeNull();
    expect(extractPayload("#")).toBeNull();
    expect(extractPayload("#foo=1&bar=2")).toBeNull();
    expect(extractPayload("#dd=abc")).toBeNull();
  });

  it("lấy đúng d kể cả khi đứng sau tham số khác hoặc rỗng", () => {
    expect(extractPayload("#d=abc")).toBe("abc");
    expect(extractPayload("#foo=1&d=abc")).toBe("abc");
    expect(extractPayload("#d=")).toBe("");
    expect(extractPayload("d=g.abc")).toBe("g.abc");
  });

  it("không giải mã + thành khoảng trắng như URLSearchParams", () => {
    expect(extractPayload("#d=a+b/c=")).toBe("a+b/c=");
  });
});

describe("ShareView (Task145)", () => {
  it("AC3: không có #d= thì hiện trạng thái missing, không ném lỗi console", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setHash("");
    renderView();

    expect(await screen.findByTestId("share-missing")).toBeTruthy();
    expect(screen.getByText(messagesVi.view.missingTitle)).toBeTruthy();
    expect(screen.getByTestId("share-home-link")).toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("AC2: hash hỏng hiện mã lỗi + nút về trang chủ, không lộ stack trace", async () => {
    setHash("#d=g.khong-phai-base64url-hop-le!!");
    const { container } = renderView();

    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByTestId("share-invalid-code").textContent).toContain("SNAPSHOT_CORRUPT");
    expect(screen.getByTestId("share-home-link")).toBeTruthy();
    expect(container.textContent).not.toContain("at ");
    expect(container.textContent).not.toContain("SnapshotError:");
  });

  it("AC2: sai version hiện đúng mã SNAPSHOT_VERSION_UNSUPPORTED", async () => {
    setHash("#d=" + rawPayload({ v: 2, project: { name: "x", engine: "postgres" }, tabs: [] }));
    renderView();

    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByTestId("share-invalid-code").textContent).toContain("SNAPSHOT_VERSION_UNSUPPORTED");
  });

  it("ca biên: payload vượt 32KB báo SNAPSHOT_TOO_LARGE, không treo trang", async () => {
    setHash("#d=g." + "A".repeat(33 * 1024));
    renderView();

    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByTestId("share-invalid-code").textContent).toContain("SNAPSHOT_TOO_LARGE");
  });

  it("AC1: link hợp lệ render snapshot, hiện đủ tab và SQL", async () => {
    const payload = await snapshotPayload();
    setHash("#d=" + payload);
    renderView();

    // Trước khi giải mã xong phải thấy trạng thái loading, không phải trang trắng.
    expect(screen.getByTestId("share-loading")).toBeTruthy();
    expect(await screen.findByTestId("readonly-workspace")).toBeTruthy();
    expect(screen.getByText("Dự án Bán hàng")).toBeTruthy();
    expect(screen.getByText("01_schema.sql")).toBeTruthy();
    expect(screen.getByText("02_query.sql")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("CREATE TABLE orders"));
  });

  it("AC5: SQL chứa thẻ HTML vẫn là chữ, không thành DOM sống", async () => {
    const payload = await snapshotPayload({
      v: 1,
      project: { name: "<b>Dự án</b>", engine: "postgres" },
      tabs: [{ name: "<img src=x onerror=alert(1)>.sql", sql: "SELECT '<img src=x onerror=alert(1)>';" }],
    });
    setHash("#d=" + payload);
    const { container } = renderView();

    await screen.findByTestId("readonly-workspace");
    await waitFor(() => expect(container.textContent).toContain("<img src=x onerror=alert(1)>"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("đổi hash thì giải mã lại và thay nội dung cũ", async () => {
    const first = await snapshotPayload(baseSnapshot());
    setHash("#d=" + first);
    renderView();
    expect(await screen.findByText("Dự án Bán hàng")).toBeTruthy();

    const second = await snapshotPayload({
      v: 1,
      project: { name: "Dự án Thứ hai", engine: "sqlite" },
      tabs: [{ name: "a.sql", sql: "SELECT 2;" }],
    });
    setHash("#d=" + second);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await waitFor(() => expect(screen.getByText("Dự án Thứ hai")).toBeTruthy());
    expect(screen.queryByText("Dự án Bán hàng")).toBeNull();
  });

  it("AC6: bản tiếng Anh có đủ 4 trạng thái", async () => {
    setHash("");
    renderView("en");
    expect(await screen.findByText(messagesEn.view.missingTitle)).toBeTruthy();

    cleanup();
    const payload = await snapshotPayload();
    setHash("#d=" + payload);
    renderView("en");
    expect(await screen.findByTestId("readonly-workspace")).toBeTruthy();
    expect(screen.getByText("Dự án Bán hàng")).toBeTruthy();
  });
});
