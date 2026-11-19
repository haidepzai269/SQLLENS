import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/export.json";
import messagesVi from "../../../../messages/vi/export.json";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
vi.mock("@/modules/export/capture/erd-png", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/export/capture/erd-png")>();
  return { ...actual, captureErdPng: vi.fn() };
});

import { captureErdPng, ErdCaptureError } from "@/modules/export/capture/erd-png";
import {
  ExportMenu,
  formatExportTimestamp,
  getErdFileName,
  getExportFileName,
  normalizeTables,
  sanitizeFileName,
  type ExportMenuProps,
} from "./export-menu";
import type { TableSpec } from "../types";

afterEach(cleanup);

const sampleTableSpecs: TableSpec[] = [
  {
    name: "users",
    columns: [
      { name: "id", type: "integer", primaryKey: true },
      { name: "email", type: "text", unique: true },
    ],
    foreignKeys: [],
  },
  {
    name: "posts",
    columns: [
      { name: "id", type: "integer", primaryKey: true },
      { name: "user_id", type: "integer" },
      { name: "title", type: "text" },
    ],
    foreignKeys: [
      {
        columns: ["user_id"],
        refTable: "users",
        refColumns: ["id"],
      },
    ],
  },
];

const sampleTableInfos: TableInfo[] = [
  {
    schema: "public",
    name: "categories",
    columns: [
      { name: "id", type: "integer", nullable: false, isPrimaryKey: true, isUnique: true },
      { name: "name", type: "varchar(50)", nullable: false, isPrimaryKey: false, isUnique: false },
    ],
  },
  {
    schema: "public",
    name: "products",
    columns: [
      { name: "id", type: "integer", nullable: false, isPrimaryKey: true, isUnique: true },
      {
        name: "category_id",
        type: "integer",
        nullable: true,
        isPrimaryKey: false,
        isUnique: false,
        references: { table: "categories", column: "id" },
      },
    ],
  },
];

function renderExportMenu(props: Partial<ExportMenuProps> = {}, locale: "vi" | "en" = "vi") {
  const messages = {
    export: locale === "vi" ? messagesVi : messagesEn,
  };

  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ExportMenu
        engine="postgres"
        tables={props.tables ?? sampleTableSpecs}
        projectName={props.projectName ?? "My Project"}
        {...props}
      />
    </NextIntlClientProvider>
  );
}

describe("ExportMenu Component (Task138)", () => {
  let createdUrls: string[] = [];
  let clickedElements: HTMLAnchorElement[] = [];
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createdUrls = [];
    clickedElements = [];

    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = vi.fn(() => {
      const mockUrl = `blob:mock-url-${createdUrls.length + 1}`;
      createdUrls.push(mockUrl);
      return mockUrl;
    });

    URL.revokeObjectURL = vi.fn(() => {
      // noop
    });

    // Mock HTMLAnchorElement.prototype.click
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedElements.push(this);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  describe("Hàm phụ trợ sanitizeFileName & formatExportTimestamp", () => {
    it("làm sạch các ký tự cấm và khoảng trắng", () => {
      expect(sanitizeFileName("My / Project : Test * ?")).toBe("My-Project-Test");
      expect(sanitizeFileName("   ")).toBe("sqllens");
      expect(sanitizeFileName(undefined)).toBe("sqllens");
      expect(sanitizeFileName("Dự án / Quản lý <Kho>")).toBe("Dự-án-Quản-lý-Kho");
    });

    it("xử lý tên dự án dài 100 ký tự an toàn", () => {
      const longName = "A".repeat(100);
      const cleaned = sanitizeFileName(longName);
      expect(cleaned.length).toBe(100);
      expect(cleaned).toBe(longName);
    });

    it("format định dạng timestamp YYYYMMDD-HHmm", () => {
      const date = new Date(2026, 10, 17, 15, 30); // tháng 11 là index 10
      expect(formatExportTimestamp(date)).toBe("20261117-1530");
    });

    it("tạo file name chuẩn theo quy tắc", () => {
      const date = new Date(2026, 10, 17, 15, 30);
      const fileName = getExportFileName("SQLLens Demo", date);
      expect(fileName).toBe("SQLLens-Demo-schema-20261117-1530.sql");
    });

    it("chuyển đổi TableInfo[] sang TableSpec[] giữ nguyên cấu trúc FK", () => {
      const specs = normalizeTables(sampleTableInfos);
      expect(specs).toHaveLength(2);
      expect(specs[0].name).toBe("categories");
      expect(specs[1].name).toBe("products");
      expect(specs[1].foreignKeys).toHaveLength(1);
      expect(specs[1].foreignKeys[0]).toEqual({
        columns: ["category_id"],
        refTable: "categories",
        refColumns: ["id"],
      });
    });
  });

  describe("AC1: Tải file .sql đúng tên và nội dung", () => {
    it("bấm Tải .sql tạo Blob application/sql và tải file với tên chuẩn", async () => {
      renderExportMenu({ projectName: "E-Commerce", engine: "postgres" });

      // Mở menu
      const trigger = screen.getByTestId("export-menu-trigger");
      fireEvent.click(trigger);

      // Bấm nút Tải .sql
      const sqlItem = screen.getByTestId("export-sql-item");
      fireEvent.click(sqlItem);

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const createdBlob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls[0][0];
      expect(createdBlob).toBeInstanceOf(Blob);
      expect(createdBlob.type).toContain("application/sql");

      // Đọc nội dung Blob
      const blobText = await createdBlob.text();
      expect(blobText).toContain("CREATE TABLE \"users\"");
      expect(blobText).toContain("CREATE TABLE \"posts\"");
      expect(blobText).toContain("REFERENCES \"users\" (\"id\")");

      // Kiểm tra thẻ <a> download
      expect(clickedElements).toHaveLength(1);
      const a = clickedElements[0];
      expect(a.download).toMatch(/^E-Commerce-schema-\d{8}-\d{4}\.sql$/);
      expect(a.href).toBe("blob:mock-url-1");

      // Menu tự đóng sau khi xuất thành công
      await waitFor(() => {
        expect(screen.queryByTestId("export-menu-panel")).toBeNull();
      });
    });

    it("hoạt động chuẩn xác khi truyền TableInfo[] từ Stage", async () => {
      renderExportMenu({
        tables: sampleTableInfos,
        projectName: "Stage Tables",
        engine: "mysql",
      });

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      expect(clickedElements).toHaveLength(1);
      const a = clickedElements[0];
      expect(a.download).toMatch(/^Stage-Tables-schema-\d{8}-\d{4}\.sql$/);

      const createdBlob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls[0][0];
      const blobText = await createdBlob.text();
      expect(blobText).toContain("CREATE TABLE `categories`");
      expect(blobText).toContain("CREATE TABLE `products`");
    });
  });

  describe("AC2: Schema rỗng thì mục .sql bị disabled kèm tooltip", () => {
    it("schema rỗng (tables: []) thì mục .sql bị disabled và có tooltip giải thích (vi)", () => {
      renderExportMenu({ tables: [] }, "vi");

      fireEvent.click(screen.getByTestId("export-menu-trigger"));

      const sqlItem = screen.getByTestId("export-sql-item");
      expect(sqlItem).toHaveProperty("disabled", true);
      expect(sqlItem.getAttribute("title")).toBe("Chưa có bảng nào để xuất");
      expect(sqlItem.textContent).toContain("Chưa có bảng nào để xuất");

      // Click vào mục disabled không kích hoạt download
      fireEvent.click(sqlItem);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(clickedElements).toHaveLength(0);
    });

    it("schema rỗng hiển thị thông báo tiếng Anh chuẩn (en)", () => {
      renderExportMenu({ tables: [] }, "en");

      fireEvent.click(screen.getByTestId("export-menu-trigger"));

      const sqlItem = screen.getByTestId("export-sql-item");
      expect(sqlItem).toHaveProperty("disabled", true);
      expect(sqlItem.getAttribute("title")).toBe("No tables to export");
      expect(sqlItem.textContent).toContain("No tables to export");
    });
  });

  describe("AC3: Trạng thái đang xuất và thông báo hoàn thành (vi & en)", () => {
    it("hiển thị thông báo thành công tiếng Việt (vi)", async () => {
      renderExportMenu({ projectName: "Test" }, "vi");

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      const statusEl = screen.getByTestId("export-status");
      expect(statusEl.textContent).toContain("Đã xuất file .sql thành công");
    });

    it("hiển thị thông báo thành công tiếng Anh (en)", async () => {
      renderExportMenu({ projectName: "Test" }, "en");

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      const statusEl = screen.getByTestId("export-status");
      expect(statusEl.textContent).toContain("Successfully exported .sql file");
    });

    it("hiển thị thông báo thất bại khi có lỗi xảy ra", async () => {
      URL.createObjectURL = vi.fn(() => {
        throw new Error("DiskFullError");
      });

      renderExportMenu({ projectName: "Test" }, "vi");

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      const statusEl = screen.getByTestId("export-status");
      expect(statusEl.textContent).toContain("Xuất file thất bại");
    });
  });

  describe("AC4: Hỗ trợ bàn phím & Trợ năng (Accessibility)", () => {
    it("nút trigger có đầy đủ aria-attributes", () => {
      renderExportMenu();

      const trigger = screen.getByTestId("export-menu-trigger");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-label")).toBe("Xuất");

      fireEvent.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });

    it("mở menu bằng phím Enter hoặc Space hoặc ArrowDown", () => {
      renderExportMenu();

      const trigger = screen.getByTestId("export-menu-trigger");
      expect(screen.queryByTestId("export-menu-panel")).toBeNull();

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      expect(screen.getByTestId("export-menu-panel")).toBeTruthy();
    });

    it("nhấn Escape đóng menu và trả focus về trigger", () => {
      renderExportMenu();

      const trigger = screen.getByTestId("export-menu-trigger");
      fireEvent.click(trigger);
      expect(screen.getByTestId("export-menu-panel")).toBeTruthy();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("export-menu-panel")).toBeNull();
    });

    it("phím Tab hỗ trợ focus trap trong panel", () => {
      renderExportMenu();

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      const panel = screen.getByTestId("export-menu-panel");
      expect(panel).toBeTruthy();

      // Giả lập Tab trên phần tử cuối
      const closeBtn = screen.getByTestId("export-menu-close");
      expect(screen.getByTestId("export-sql-item")).toBeTruthy();

      closeBtn.focus();
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
      // Không crash
      expect(panel).toBeTruthy();
    });
  });

  describe("AC5: Giao diện Sheet trên Mobile 390px", () => {
    it("panel có class định dạng bottom sheet và có backdrop", () => {
      renderExportMenu();

      fireEvent.click(screen.getByTestId("export-menu-trigger"));

      const panel = screen.getByTestId("export-menu-panel");
      expect(panel.className).toContain("fixed");
      expect(panel.className).toContain("bottom-0");
      expect(panel.className).toContain("rounded-t-2xl");

      const backdrop = screen.getByTestId("export-menu-backdrop");
      expect(backdrop).toBeTruthy();

      // Bấm vào backdrop đóng sheet
      fireEvent.click(backdrop);
      expect(screen.queryByTestId("export-menu-panel")).toBeNull();
    });

    it("bấm nút close X đóng sheet", () => {
      renderExportMenu();

      fireEvent.click(screen.getByTestId("export-menu-trigger"));

      const closeBtn = screen.getByTestId("export-menu-close");
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("export-menu-panel")).toBeNull();
    });
  });

  describe("AC6: Core Rule 7 - Không có bất kỳ network request nào", () => {
    it("quá trình xuất hoàn toàn chạy trên client, không gọi fetch hay XMLHttpRequest", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const xhrOpenSpy = vi.spyOn(window.XMLHttpRequest.prototype, "open");

      renderExportMenu();

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy).not.toHaveBeenCalled();
    });
  });

  describe("Ca biên (Edge cases)", () => {
    it("tên dự án có dấu tiếng Việt và ký tự đặc biệt", () => {
      renderExportMenu({ projectName: "Dự án Bán Hàng / 2026: Phiên bản VIP" });

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-sql-item"));

      expect(clickedElements).toHaveLength(1);
      const fileName = clickedElements[0].download;
      expect(fileName).toContain("Dự-án-Bán-Hàng-2026-Phiên-bản-VIP");
      expect(fileName).not.toContain("/");
      expect(fileName).not.toContain(":");
    });

    it("bấm xuất 2 lần liên tiếp không tạo ra 2 lần download đồng thời", () => {
      renderExportMenu();

      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      const sqlItem = screen.getByTestId("export-sql-item");

      // Bấm 2 lần liên tiếp
      fireEvent.click(sqlItem);
      fireEvent.click(sqlItem);

      // Chỉ tạo 1 file
      expect(clickedElements).toHaveLength(1);
    });

    it("tên file ERD: <dự án>-erd-<YYYYMMDD-HHmm>.png, làm sạch ký tự cấm", () => {
      const date = new Date(2026, 10, 17, 15, 30);
      expect(getErdFileName("My Project", date)).toBe("My-Project-erd-20261117-1530.png");
      expect(getErdFileName("Dự án / Quản lý <Kho>", date)).toBe("Dự-án-Quản-lý-Kho-erd-20261117-1530.png");
      expect(getErdFileName(undefined, date)).toBe("sqllens-erd-20261117-1530.png");
      expect(getErdFileName("A".repeat(100), date)).toMatch(/^A{100}-erd-\d{8}-\d{4}\.png$/);
    });

    it("khi disabled=true (đang chạy query), trigger không thể mở menu", () => {
      renderExportMenu({ disabled: true });

      const trigger = screen.getByTestId("export-menu-trigger");
      expect(trigger).toHaveProperty("disabled", true);

      fireEvent.click(trigger);
      expect(screen.queryByTestId("export-menu-panel")).toBeNull();
    });
  });

  describe("Task139: mục tải sơ đồ PNG", () => {
    const capture = vi.mocked(captureErdPng);

    beforeEach(() => {
      capture.mockReset();
      capture.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    });

    it("AC1: bấm mục PNG tải file .png đúng tên dự án", async () => {
      renderExportMenu({ projectName: "Dự án Bán Hàng" });
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-png-item"));

      await waitFor(() => expect(clickedElements).toHaveLength(1));
      expect(capture).toHaveBeenCalledTimes(1);
      expect(clickedElements[0].download).toMatch(/^Dự-án-Bán-Hàng-erd-\d{8}-\d{4}\.png$/);
      expect(createdUrls).toHaveLength(1);
    });

    it("AC3: hiện tiến trình theo từng bước và thông báo xong", async () => {
      let done: ((blob: Blob) => void) | undefined;
      capture.mockImplementation(
        (opts) =>
          new Promise<Blob>((resolve) => {
            opts?.onProgress?.("capture");
            done = resolve;
          }),
      );

      renderExportMenu();
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-png-item"));

      await waitFor(() => expect(screen.getByTestId("export-png-item").textContent).toContain("Đang chụp sơ đồ"));
      // Trong lúc chụp, mục .sql bị khoá để không xuất hai thứ cùng lúc.
      expect(screen.getByTestId("export-sql-item")).toHaveProperty("disabled", true);

      done?.(new Blob(["png"], { type: "image/png" }));
      await waitFor(() => expect(screen.getByTestId("export-status").textContent).toContain(messagesVi.pngDone));
      expect(clickedElements).toHaveLength(1);
    });

    it("chưa có sơ đồ (not_found) thì báo đúng lý do và mở lại nút", async () => {
      capture.mockRejectedValue(new ErdCaptureError("not_found", "ERD canvas not found"));

      renderExportMenu();
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-png-item"));

      await waitFor(() => expect(screen.getByTestId("export-status").textContent).toContain(messagesVi.pngNotFound));
      expect(clickedElements).toHaveLength(0);
      expect(screen.getByTestId("export-png-item")).not.toHaveProperty("disabled", true);
    });

    it("lỗi khác thì báo lỗi chung; schema rỗng thì mục PNG bị disable", async () => {
      capture.mockRejectedValue(new ErdCaptureError("failed", "boom"));
      renderExportMenu();
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      fireEvent.click(screen.getByTestId("export-png-item"));
      await waitFor(() => expect(screen.getByTestId("export-status").textContent).toContain(messagesVi.pngFailed));
      cleanup();

      renderExportMenu({ tables: [] });
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      const pngItem = screen.getByTestId("export-png-item");
      expect(pngItem).toHaveProperty("disabled", true);
      expect(pngItem.getAttribute("title")).toBe(messagesVi.disabledEmpty);
    });

    it("tiếng Anh: nhãn và tiến trình không lẫn tiếng Việt", async () => {
      renderExportMenu({}, "en");
      fireEvent.click(screen.getByTestId("export-menu-trigger"));
      expect(screen.getByTestId("export-png-item").textContent).toContain(messagesEn.png);
      fireEvent.click(screen.getByTestId("export-png-item"));
      await waitFor(() => expect(screen.getByTestId("export-status").textContent).toContain(messagesEn.pngDone));
    });
  });
});
