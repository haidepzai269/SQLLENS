/**
 * Copyright (c) 2026 SQLLens
 * Unit & Integration tests for CodeMirror 6 Inline Ghost Text Extension.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  acceptGhostText,
  createInlineGhostTextExtension,
  dismissGhostText,
  ghostTextDecorations,
  ghostTextField,
  GhostTextWidget,
  type InlineGhostTextOptions,
} from "./inline-ghost-text";
import type { ForeignKeyRelation, TableSchema } from "@/modules/editor/heuristics/types";

function createTestView(
  doc: string,
  cursorOffset: number,
  options: InlineGhostTextOptions = {}
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorOffset },
    extensions: [createInlineGhostTextExtension(options)],
  });
  return new EditorView({ state });
}

describe("Inline Ghost Text Extension (Task 110)", () => {
  const mockTables: TableSchema = {
    users: ["id", "name", "email"],
    orders: ["id", "user_id", "total", "status"],
  };

  const mockForeignKeys: ForeignKeyRelation[] = [
    {
      fromTable: "orders",
      fromColumn: "user_id",
      toTable: "users",
      toColumn: "id",
    },
  ];

  describe("AC1: Trạng thái enabled & Zero overhead", () => {
    it("trả về extension rỗng [] khi enabled === false", () => {
      const ext = createInlineGhostTextExtension({ enabled: false });
      expect(ext).toEqual([]);
    });

    it("trả về mảng extension hợp lệ khi enabled === true hoặc mặc định", () => {
      const extDefault = createInlineGhostTextExtension();
      expect(Array.isArray(extDefault)).toBe(true);
      expect((extDefault as unknown[]).length).toBeGreaterThan(0);

      const extExplicit = createInlineGhostTextExtension({ enabled: true });
      expect(Array.isArray(extExplicit)).toBe(true);
      expect((extExplicit as unknown[]).length).toBeGreaterThan(0);
    });
  });

  describe("AC2 & AC3: Widget decoration và thẩm mỹ CSS class", () => {
    it("render GhostTextWidget đúng class CSS yêu cầu", () => {
      const widget = new GhostTextWidget(" ON u.id = o.user_id");
      const dom = widget.toDOM();

      expect(dom.tagName).toBe("SPAN");
      expect(dom.className).toBe(
        "opacity-40 select-none pointer-events-none text-muted-foreground font-mono inline-block"
      );
      expect(dom.textContent).toBe(" ON u.id = o.user_id");
      expect(dom.getAttribute("aria-hidden")).toBe("true");

      const sameWidget = new GhostTextWidget(" ON u.id = o.user_id");
      const diffWidget = new GhostTextWidget(" other");
      expect(widget.eq(sameWidget)).toBe(true);
      expect(widget.eq(diffWidget)).toBe(false);
    });

    it("tạo decoration widget ngay tại vị trí con trỏ khi khớp Heuristics GROUP BY", () => {
      const doc = "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      const ghost = view.state.field(ghostTextField);
      expect(ghost).not.toBeNull();
      expect(ghost?.text).toBe("u.id, u.name");
      expect(ghost?.from).toBe(doc.length);

      const decos = view.state.field(ghostTextDecorations);
      let foundText = "";
      decos.between(0, view.state.doc.length, (_from, _to, value) => {
        const spec = (value as unknown as { spec?: { widget?: GhostTextWidget } }).spec;
        if (spec?.widget) {
          foundText = spec.widget.text;
        }
      });
      expect(foundText).toBe("u.id, u.name");
    });

    it("hỗ trợ đọc tables và foreignKeys thông qua getter functions", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        getTables: () => mockTables,
        getForeignKeys: () => mockForeignKeys,
      });

      const ghost = view.state.field(ghostTextField);
      expect(ghost).not.toBeNull();
      expect(ghost?.text).toBe("users u ON u.id = o.user_id");
    });
  });

  describe("AC4: Xử lý phím tắt Tab nhận và Escape hủy", () => {
    it("nhấn Tab: chèn toàn bộ nội dung ghost text và dời con trỏ về cuối đoạn vừa chèn", () => {
      const doc = "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
      });

      expect(view.state.field(ghostTextField)?.text).toBe("u.id, u.name");

      const handled = acceptGhostText(view);
      expect(handled).toBe(true);

      expect(view.state.doc.toString()).toBe(
        "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY u.id, u.name"
      );
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
      // Ghost text bị xóa sau khi đã nhận
      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("nhấn Tab khi không có ghost text: trả về false để fallback thụt lề bình thường", () => {
      const doc = "SELECT 1;";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
      });

      expect(view.state.field(ghostTextField)).toBeNull();
      const handled = acceptGhostText(view);
      expect(handled).toBe(false);
    });

    it("nhấn Escape: hủy bỏ ghost text ngay lập tức mà không thay đổi văn bản", () => {
      const doc = "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
      });

      expect(view.state.field(ghostTextField)).not.toBeNull();

      const dismissed = dismissGhostText(view);
      expect(dismissed).toBe(true);

      // Doc không bị thay đổi
      expect(view.state.doc.toString()).toBe(doc);
      // Trạng thái ghost text đã về null
      expect(view.state.field(ghostTextField)).toBeNull();

      // Nhấn Escape lần nữa khi đã null -> trả về false
      expect(dismissGhostText(view)).toBe(false);
    });
  });

  describe("AC5: Type-ahead và vùng bôi đen (Selection)", () => {
    it("cắt ngắn chuỗi ghost text khi người dùng gõ ký tự trùng với ký tự đầu", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      // Gợi ý ban đầu là "users u ON u.id = o.user_id"
      expect(view.state.field(ghostTextField)?.text).toBe("users u ON u.id = o.user_id");

      // Người dùng gõ 'u'
      view.dispatch({
        changes: { from: doc.length, insert: "u" },
        selection: { anchor: doc.length + 1 },
      });

      expect(view.state.field(ghostTextField)?.text).toBe("sers u ON u.id = o.user_id");
      expect(view.state.field(ghostTextField)?.from).toBe(doc.length + 1);

      // Người dùng gõ tiếp 's'
      view.dispatch({
        changes: { from: doc.length + 1, insert: "s" },
        selection: { anchor: doc.length + 2 },
      });

      expect(view.state.field(ghostTextField)?.text).toBe("ers u ON u.id = o.user_id");
      expect(view.state.field(ghostTextField)?.from).toBe(doc.length + 2);
    });

    it("hủy bỏ ghost text ngay lập tức khi người dùng gõ ký tự không khớp", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      expect(view.state.field(ghostTextField)?.text).toBe("users u ON u.id = o.user_id");

      // Người dùng gõ 'x' thay vì 'u'
      view.dispatch({
        changes: { from: doc.length, insert: "x" },
        selection: { anchor: doc.length + 1 },
      });

      // Ký tự không khớp, Heuristics tại vị trí này cũng không có -> null
      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("hủy bỏ ghost text khi con trỏ có vùng bôi đen (!selection.main.empty)", () => {
      const doc = "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
      });

      expect(view.state.field(ghostTextField)).not.toBeNull();

      // Bôi đen từ ký tự 0 đến 6
      view.dispatch({
        selection: { anchor: 0, head: 6 },
      });

      expect(view.state.field(ghostTextField)).toBeNull();
    });
    it("xóa ghost text khi người dùng gõ hết tất cả ký tự trong ghost text qua type-ahead", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      const initialGhost = view.state.field(ghostTextField)?.text ?? "";
      expect(initialGhost.length).toBeGreaterThan(0);

      // Mô phỏng gõ từng ký tự của ghost text cho đến hết
      let currentOffset = doc.length;
      for (const char of initialGhost) {
        view.dispatch({
          changes: { from: currentOffset, insert: char },
          selection: { anchor: currentOffset + 1 },
        });
        currentOffset++;
      }

      // Khi đã gõ hết toàn bộ ký tự, ghost text trở về null
      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("hỗ trợ type-ahead không phân biệt hoa thường khi gõ chữ cái", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      // Gợi ý bắt đầu bằng 'u' ("users ...")
      expect(view.state.field(ghostTextField)?.text.startsWith("users")).toBe(true);

      // Người dùng gõ 'U' hoa
      view.dispatch({
        changes: { from: doc.length, insert: "U" },
        selection: { anchor: doc.length + 1 },
      });

      // Type-ahead nhận diện và cắt ngắn thành "sers ..."
      expect(view.state.field(ghostTextField)?.text.startsWith("sers")).toBe(true);
    });

    it("paste đoạn văn bản dài thì không kích hoạt type-ahead 1 ký tự mà tính toán lại", () => {
      const doc = "SELECT * FROM orders o JOIN ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      expect(view.state.field(ghostTextField)).not.toBeNull();

      // Paste "categories c ON c.id = o.cat_id" (nhiều ký tự)
      view.dispatch({
        changes: { from: doc.length, insert: "categories c ON c.id = o.cat_id" },
        selection: { anchor: doc.length + 31 },
      });

      // Không thể type-ahead 1 ký tự, Heuristics tại vị trí này không khớp -> null
      expect(view.state.field(ghostTextField)).toBeNull();
    });
  });

  describe("Ca biên & Ổn định (Robustness)", () => {
    it("xử lý an toàn khi doc rỗng", () => {
      const view = createTestView("", 0, { tables: mockTables });
      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("xử lý an toàn khi schema rỗng hoặc undefined", () => {
      const doc = "INSERT INTO users ";
      const view = createTestView(doc, doc.length, {});
      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("hủy ghost text cũ khi con trỏ di chuyển bằng phím mũi tên hoặc chuột", () => {
      const doc = "SELECT u.id, u.name, COUNT(o.id) FROM users u GROUP BY ";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
      });

      expect(view.state.field(ghostTextField)).not.toBeNull();

      // Di chuyển con trỏ về vị trí 10 mà không thay đổi văn bản
      view.dispatch({
        selection: { anchor: 10 },
      });

      expect(view.state.field(ghostTextField)).toBeNull();
    });

    it("tính toán lại khi người dùng xóa lùi (Backspace)", () => {
      const doc = "SELECT * FROM orders o JOIN unknown_tbl";
      const view = createTestView(doc, doc.length, {
        tables: mockTables,
        foreignKeys: mockForeignKeys,
      });

      // Ban đầu không khớp gợi ý (vì unknown_tbl không có quan hệ FK)
      expect(view.state.field(ghostTextField)).toBeNull();

      // Xóa chữ "unknown_tbl" lùi về "JOIN "
      view.dispatch({
        changes: { from: doc.length - 11, to: doc.length },
        selection: { anchor: doc.length - 11 },
      });

      // Sau khi xóa lùi về "JOIN ", Heuristics tự động tính lại và gợi ý FK
      expect(view.state.field(ghostTextField)?.text).toBe("users u ON u.id = o.user_id");
    });
  });
});
