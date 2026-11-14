/**
 * Copyright (c) 2026 SQLLens
 * Unit & Integration tests for CodeMirror 6 AI Copilot Multi-line Ghost Text Extension.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  autocompletion,
  closeCompletion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  acceptAiGhostText,
  aiGhostTextDecorations,
  aiGhostTextField,
  AiGhostTextWidget,
  createAiCopilotExtension,
  dismissAiGhostText,
  extractContext,
  formatSchemaSnippet,
  isCommentTrigger,
  isDebounceTrigger,
  setAiGhostTextEffect,
  triggerManualAiCopilot,
  type AiCopilotOptions,
} from "./ai-copilot";
import {
  createInlineGhostTextExtension,
  ghostTextField,
  setGhostTextEffect,
} from "./inline-ghost-text";

function createTestView(
  doc: string,
  cursorOffset: number,
  options: AiCopilotOptions = {}
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorOffset },
    extensions: [createAiCopilotExtension(options)],
  });
  return new EditorView({ state });
}

describe("AI Copilot Extension (Task 112)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AC1: Trạng thái enabled & Zero overhead", () => {
    it("trả về extension rỗng [] khi enabled === false", () => {
      const ext = createAiCopilotExtension({ enabled: false });
      expect(ext).toEqual([]);
    });

    it("trả về mảng extension hợp lệ khi enabled === true", () => {
      const ext = createAiCopilotExtension({ enabled: true, isVip: true });
      expect(Array.isArray(ext)).toBe(true);
      expect((ext as unknown[]).length).toBeGreaterThan(0);
    });
  });

  describe("AC2: Manual Trigger với Free User (!isVip) & VIP User", () => {
    it("gọi onRequireUpgrade() khi người dùng Free kích hoạt Manual Trigger", () => {
      const onRequireUpgrade = vi.fn();
      const view = createTestView("SELECT * FROM", 13, {
        enabled: true,
        isVip: false,
        onRequireUpgrade,
      });

      const handled = triggerManualAiCopilot(view);

      expect(handled).toBe(true);
      expect(onRequireUpgrade).toHaveBeenCalledTimes(1);
    });

    it("gọi AI fetch khi tài khoản VIP kích hoạt Manual Trigger", async () => {
      const fetchCompletion = vi.fn().mockResolvedValue({
        completion: " orders WHERE status = 'active';",
        finishReason: "stop",
      });

      const view = createTestView("SELECT * FROM", 13, {
        enabled: true,
        isVip: true,
        fetchCompletion,
      });

      const handled = triggerManualAiCopilot(view);
      expect(handled).toBe(true);

      // Chạy async task
      await vi.runAllTimersAsync();

      expect(fetchCompletion).toHaveBeenCalledTimes(1);
      expect(fetchCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: "SELECT * FROM",
          suffix: "",
        })
      );

      // Sau khi fetch xong, ghost text phải xuất hiện
      const ghost = view.state.field(aiGhostTextField);
      expect(ghost).not.toBeNull();
      expect(ghost?.text).toBe(" orders WHERE status = 'active';");
      expect(ghost?.from).toBe(13);
    });
  });

  describe("AC3: Widget decoration & Thẩm mỹ Multi-line Ghost Text CSS class", () => {
    it("render AiGhostTextWidget với class whitespace-pre inline chuẩn xác cho nhiều dòng", () => {
      const multiLineText = ` users\nWHERE active = true\nORDER BY created_at DESC;`;
      const widget = new AiGhostTextWidget(multiLineText);
      const dom = widget.toDOM();

      expect(dom.tagName).toBe("SPAN");
      expect(dom.className).toBe(
        "opacity-40 select-none pointer-events-none text-muted-foreground font-mono whitespace-pre inline"
      );
      expect(dom.textContent).toBe(multiLineText);
      expect(dom.getAttribute("aria-hidden")).toBe("true");

      const sameWidget = new AiGhostTextWidget(multiLineText);
      const diffWidget = new AiGhostTextWidget("diff");
      expect(widget.eq(sameWidget)).toBe(true);
      expect(widget.eq(diffWidget)).toBe(false);
    });

    it("aiGhostTextDecorations cung cấp đúng decoration tại vị trí con trỏ", () => {
      const view = createTestView("SELECT 1", 8, { enabled: true, isVip: true });
      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: "\nUNION ALL\nSELECT 2;",
          from: 8,
        }),
      });

      const deco = view.state.field(aiGhostTextDecorations);
      expect(deco.size).toBe(1);

      let foundWidget = false;
      deco.between(8, 8, (_from, _to, value) => {
        if (value.spec.widget instanceof AiGhostTextWidget) {
          foundWidget = true;
          expect(value.spec.widget.text).toBe("\nUNION ALL\nSELECT 2;");
        }
      });
      expect(foundWidget).toBe(true);
    });
  });

  describe("AC4: Xử lý phím tắt Tab (Accept) và Escape (Dismiss)", () => {
    it("nhấn Tab chấp nhận chèn trọn vẹn khối mã đa dòng và đưa con trỏ về cuối", () => {
      const initialDoc = "SELECT * FROM users";
      const view = createTestView(initialDoc, initialDoc.length, {
        enabled: true,
        isVip: true,
      });

      const multiLineGhost = "\nWHERE role = 'admin'\nLIMIT 10;";
      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: multiLineGhost,
          from: initialDoc.length,
        }),
      });

      const accepted = acceptAiGhostText(view);

      expect(accepted).toBe(true);
      expect(view.state.doc.toString()).toBe(initialDoc + multiLineGhost);
      expect(view.state.selection.main.head).toBe((initialDoc + multiLineGhost).length);
      expect(view.state.field(aiGhostTextField)).toBeNull();
    });

    it("nhấn Tab trả về false khi không có AI Ghost Text (không chặn thao tác thụt lề thông thường)", () => {
      const view = createTestView("SELECT 1", 8, { enabled: true, isVip: true });
      const accepted = acceptAiGhostText(view);
      expect(accepted).toBe(false);
    });

    it("nhấn Escape hủy bỏ gợi ý AI mà không làm thay đổi tài liệu", () => {
      const doc = "SELECT id FROM orders";
      const view = createTestView(doc, doc.length, { enabled: true, isVip: true });

      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: " WHERE amount > 100",
          from: doc.length,
        }),
      });
      expect(view.state.field(aiGhostTextField)).not.toBeNull();

      const dismissed = dismissAiGhostText(view);

      expect(dismissed).toBe(true);
      expect(view.state.field(aiGhostTextField)).toBeNull();
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("tiếp tục gõ ký tự bất kỳ tự động xóa AI Ghost Text cũ", () => {
      const doc = "SELECT";
      const view = createTestView(doc, doc.length, { enabled: true, isVip: true });

      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: " * FROM users",
          from: doc.length,
        }),
      });
      expect(view.state.field(aiGhostTextField)).not.toBeNull();

      // Người dùng gõ thêm dấu cách
      view.dispatch({
        changes: { from: doc.length, insert: " " },
        selection: { anchor: doc.length + 1 },
      });

      expect(view.state.field(aiGhostTextField)).toBeNull();
    });

    it("di chuyển con trỏ (selection thay đổi) tự động xóa AI Ghost Text cũ", () => {
      const doc = "SELECT 1, 2, 3;";
      const view = createTestView(doc, 8, { enabled: true, isVip: true });

      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: " extra",
          from: 8,
        }),
      });
      expect(view.state.field(aiGhostTextField)).not.toBeNull();

      // Di chuyển con trỏ về đầu
      view.dispatch({
        selection: { anchor: 0 },
      });

      expect(view.state.field(aiGhostTextField)).toBeNull();
    });
  });

  describe("AC5: Smart Triggers (Comment Trigger & Debounce Trigger) & Abort on typing", () => {
    it("isCommentTrigger nhận diện chính xác khi vừa Enter xuống dòng mới sau comment ý đồ", () => {
      const state = EditorState.create({
        doc: "-- Lấy top 5 khách hàng VIP\n",
        selection: { anchor: 28 }, // Đầu dòng 2
      });

      expect(isCommentTrigger(state.doc, 28)).toBe(true);

      // Nếu dòng 1 không phải comment
      const stateNoComment = EditorState.create({
        doc: "SELECT * FROM users\n",
        selection: { anchor: 20 },
      });
      expect(isCommentTrigger(stateNoComment.doc, 20)).toBe(false);

      // Nếu dòng 2 đã có text
      const stateWithText = EditorState.create({
        doc: "-- comment\nSELECT",
        selection: { anchor: 17 },
      });
      expect(isCommentTrigger(stateWithText.doc, 17)).toBe(false);
    });

    it("isDebounceTrigger phát hiện câu lệnh chưa hoàn tất (chưa có chấm phẩy)", () => {
      expect(isDebounceTrigger("SELECT * FROM users")).toBe(true);
      expect(isDebounceTrigger("SELECT * FROM users;")).toBe(false);
      expect(isDebounceTrigger("")).toBe(false);
      expect(isDebounceTrigger("   ")).toBe(false);
    });

    it("extractContext cắt đúng tối đa 20 dòng prefix và 5 dòng suffix", () => {
      const lines: string[] = [];
      for (let i = 1; i <= 30; i++) {
        lines.push(`-- Line ${i}`);
      }
      const fullDoc = lines.join("\n");
      const state = EditorState.create({
        doc: fullDoc,
        selection: { anchor: fullDoc.length },
      });

      const { prefix, suffix } = extractContext(state.doc, fullDoc.length);
      const prefixLines = prefix.split("\n");

      expect(prefixLines.length).toBeLessThanOrEqual(21);
      expect(suffix).toBe("");
    });

    it("formatSchemaSnippet tóm tắt schema chính xác", () => {
      const schema = {
        users: ["id", "email", "name"],
        orders: ["id", "user_id", "total"],
      };

      const snippet = formatSchemaSnippet(schema);
      expect(snippet).toBe("users(id, email, name); orders(id, user_id, total)");
    });

    it("Comment Trigger kích hoạt gọi fetchCompletion ngay lập tức (không đợi 600ms)", async () => {
      const fetchCompletion = vi.fn().mockResolvedValue({
        completion: "SELECT * FROM users ORDER BY total DESC LIMIT 5;",
        finishReason: "stop",
      });

      const initialDoc = "-- Lấy top 5 người dùng";
      const view = createTestView(initialDoc, initialDoc.length, {
        enabled: true,
        isVip: true,
        fetchCompletion,
      });

      // Người dùng nhấn Enter tạo dòng mới
      view.dispatch({
        changes: { from: initialDoc.length, insert: "\n" },
        selection: { anchor: initialDoc.length + 1 },
      });

      // Comment trigger chạy immediate, giải quyết microtasks
      await vi.runAllTimersAsync();

      expect(fetchCompletion).toHaveBeenCalledTimes(1);
      const ghost = view.state.field(aiGhostTextField);
      expect(ghost?.text).toBe("SELECT * FROM users ORDER BY total DESC LIMIT 5;");
    });

    it("Debounce Trigger kích hoạt gọi fetchCompletion sau 600ms", async () => {
      const fetchCompletion = vi.fn().mockResolvedValue({
        completion: " WHERE active = true",
        finishReason: "stop",
      });

      const view = createTestView("SELECT *", 8, {
        enabled: true,
        isVip: true,
        debounceMs: 600,
        fetchCompletion,
      });

      // Gõ thêm " FROM users"
      view.dispatch({
        changes: { from: 8, insert: " FROM users" },
        selection: { anchor: 19 },
      });

      // Chưa đủ 600ms: chưa gọi fetch
      vi.advanceTimersByTime(300);
      expect(fetchCompletion).not.toHaveBeenCalled();

      // Tiến thêm 300ms (đủ 600ms)
      await vi.advanceTimersByTimeAsync(300);

      expect(fetchCompletion).toHaveBeenCalledTimes(1);
    });

    it("Hủy (abort) request đang bay khi người dùng tiếp tục gõ phím", async () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchCompletion = vi.fn().mockImplementation((params) => {
        capturedSignal = params.signal;
        return new Promise(() => {}); // request treo đang bay
      });

      const view = createTestView("SELECT * FROM users", 19, {
        enabled: true,
        isVip: true,
        debounceMs: 200,
        fetchCompletion,
      });

      // Kích hoạt debounce
      view.dispatch({
        changes: { from: 19, insert: " " },
        selection: { anchor: 20 },
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchCompletion).toHaveBeenCalledTimes(1);
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      // Người dùng gõ tiếp chữ "W" -> request đang bay phải bị abort ngay!
      view.dispatch({
        changes: { from: 20, insert: "W" },
        selection: { anchor: 21 },
      });

      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  describe("Task 117: Precedence Dispatcher & Mutual Exclusion", () => {
    it("AC1: acceptAiGhostText nhường quyền cho Dropdown Popup (trả về false khi completionStatus === 'active')", async () => {
      const doc = "SELECT * FROM";
      const state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          autocompletion({
            override: [
              () => ({
                from: doc.length,
                options: [{ label: "users" }],
              }),
            ],
          }),
          createAiCopilotExtension({
            enabled: true,
            isVip: true,
          }),
        ],
      });
      const view = new EditorView({ state });

      // Đặt AI Ghost Text
      view.dispatch({
        effects: setAiGhostTextEffect.of({
          text: " users",
          from: doc.length,
        }),
      });
      expect(view.state.field(aiGhostTextField)).not.toBeNull();

      // Kích hoạt autocomplete dropdown
      startCompletion(view);
      await vi.advanceTimersByTimeAsync(50);
      expect(completionStatus(view.state)).toBe("active");

      // Khi dropdown active, acceptAiGhostText trả về false và không chèn text
      const handled = acceptAiGhostText(view);
      expect(handled).toBe(false);
      expect(view.state.doc.toString()).toBe(doc);

      // Đóng completion popup
      closeCompletion(view);
      expect(completionStatus(view.state)).toBeNull();

      // Khi dropdown đóng lại, phím Tab chấp nhận AI Ghost Text
      const handledAfterClose = acceptAiGhostText(view);
      expect(handledAfterClose).toBe(true);
      expect(view.state.doc.toString()).toBe("SELECT * FROM users");
    });

    it("AC2 & AC3: acceptAiGhostText nhường quyền cho Local Ghost Text nếu Local có gợi ý", () => {
      const state = EditorState.create({
        doc: "SELECT * FROM ",
        selection: { anchor: 14 },
        extensions: [
          createInlineGhostTextExtension({ enabled: true }),
          createAiCopilotExtension({ enabled: true, isVip: true }),
        ],
      });
      const view = new EditorView({ state });

      // Đặt cả AI Ghost Text và Local Ghost Text
      view.dispatch({
        effects: [
          setAiGhostTextEffect.of({ text: "orders", from: 14 }),
          setGhostTextEffect.of({ text: "users", from: 14 }),
        ],
      });

      expect(view.state.field(ghostTextField)?.text).toBe("users");
      expect(view.state.field(aiGhostTextField)?.text).toBe("orders");

      // Gọi acceptAiGhostText: phải nhường cho local -> trả về false
      const aiHandled = acceptAiGhostText(view);
      expect(aiHandled).toBe(false);
      expect(view.state.doc.toString()).toBe("SELECT * FROM ");

      // Xóa Local Ghost Text
      view.dispatch({
        effects: setGhostTextEffect.of(null),
      });

      // Bây giờ chỉ còn AI Ghost Text: acceptAiGhostText trả về true và chèn text
      const aiHandledAlone = acceptAiGhostText(view);
      expect(aiHandledAlone).toBe(true);
      expect(view.state.doc.toString()).toBe("SELECT * FROM orders");
    });

    it("AC4: AI Copilot hủy timer và không gọi API khi Local Heuristics có gợi ý (0ms Mutual Exclusion)", async () => {
      const fetchCompletion = vi.fn().mockResolvedValue({
        completion: " orders",
        finishReason: "stop",
      });

      const doc = "SELECT u.id, COUNT(o.id) FROM users u ";
      const state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          createInlineGhostTextExtension({
            enabled: true,
            tables: { users: ["id", "name"] },
          }),
          createAiCopilotExtension({
            enabled: true,
            isVip: true,
            debounceMs: 600,
            fetchCompletion,
          }),
        ],
      });
      const view = new EditorView({ state });

      // Gõ "GROUP BY " để kích hoạt Local Heuristics
      view.dispatch({
        changes: { from: doc.length, insert: "GROUP BY " },
        selection: { anchor: doc.length + 9 },
      });

      // Local Heuristics đã sinh ra gợi ý "u.id" trong 0ms
      expect(view.state.field(ghostTextField)?.text).toBe("u.id");

      // Chạy hết 600ms debounce
      await vi.advanceTimersByTimeAsync(700);

      // fetchCompletion KHÔNG ĐƯỢC PHÉP gọi vì Local đã giải quyết xong
      expect(fetchCompletion).not.toHaveBeenCalled();
    });

    it("AC4: Hủy request in-flight của AI Copilot khi gõ phím làm phát sinh Local Ghost Text", async () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchCompletion = vi.fn().mockImplementation((params) => {
        capturedSignal = params.signal;
        return new Promise(() => {}); // request treo đang bay
      });

      const initialDoc = "SELECT name FROM users WHERE active = true";
      const state = EditorState.create({
        doc: initialDoc,
        selection: { anchor: initialDoc.length },
        extensions: [
          createInlineGhostTextExtension({
            enabled: true,
            tables: { users: ["id", "name"], orders: ["id", "user_id"] },
            foreignKeys: [
              {
                fromTable: "orders",
                fromColumn: "user_id",
                toTable: "users",
                toColumn: "id",
              },
            ],
          }),
          createAiCopilotExtension({
            enabled: true,
            isVip: true,
            debounceMs: 200,
            fetchCompletion,
          }),
        ],
      });
      const view = new EditorView({ state });

      // Gõ khoảng trắng kích hoạt AI debounce (chưa có local ghost text)
      view.dispatch({
        changes: { from: initialDoc.length, insert: " " },
        selection: { anchor: initialDoc.length + 1 },
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchCompletion).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      // Gõ tiếp "JOIN " -> sinh ra Local Ghost Text "orders o ON o.user_id = users.id"
      view.dispatch({
        changes: { from: initialDoc.length + 1, insert: "JOIN " },
        selection: { anchor: initialDoc.length + 6 },
      });

      // Request đang bay của AI phải bị abort ngay lập tức!
      expect(capturedSignal?.aborted).toBe(true);
    });

    it("AC5: aiGhostTextDecorations không render widget khi Local Ghost Text đang hiển thị (chống đè)", () => {
      const state = EditorState.create({
        doc: "SELECT * FROM ",
        selection: { anchor: 14 },
        extensions: [
          createInlineGhostTextExtension({ enabled: true }),
          createAiCopilotExtension({ enabled: true, isVip: true }),
        ],
      });
      const view = new EditorView({ state });

      // Khi chỉ có AI Ghost Text
      view.dispatch({
        effects: setAiGhostTextEffect.of({ text: "orders", from: 14 }),
      });

      let aiDecoCount = 0;
      view.state.field(aiGhostTextDecorations).between(0, 14, () => {
        aiDecoCount++;
      });
      expect(aiDecoCount).toBe(1);

      // Khi xuất hiện Local Ghost Text -> AI decorations phải trả về Decoration.none
      view.dispatch({
        effects: setGhostTextEffect.of({ text: "users", from: 14 }),
      });

      let aiDecoCountWhileLocalActive = 0;
      view.state.field(aiGhostTextDecorations).between(0, 14, () => {
        aiDecoCountWhileLocalActive++;
      });
      expect(aiDecoCountWhileLocalActive).toBe(0);

      // Khi Local Ghost Text biến mất -> AI decorations lại hiển thị bình thường
      view.dispatch({
        effects: setGhostTextEffect.of(null),
      });

      let aiDecoCountAfterLocalClear = 0;
      view.state.field(aiGhostTextDecorations).between(0, 14, () => {
        aiDecoCountAfterLocalClear++;
      });
      expect(aiDecoCountAfterLocalClear).toBe(1);
    });

    it("AC6: dismissAiGhostText hủy sạch cả AI và Local Ghost Text khi nhấn Escape", () => {
      const state = EditorState.create({
        doc: "SELECT * FROM ",
        selection: { anchor: 14 },
        extensions: [
          createInlineGhostTextExtension({ enabled: true }),
          createAiCopilotExtension({ enabled: true, isVip: true }),
        ],
      });
      const view = new EditorView({ state });

      // Đặt cả 2 ghost text
      view.dispatch({
        effects: [
          setAiGhostTextEffect.of({ text: "orders", from: 14 }),
          setGhostTextEffect.of({ text: "users", from: 14 }),
        ],
      });

      expect(view.state.field(aiGhostTextField)).not.toBeNull();
      expect(view.state.field(ghostTextField)).not.toBeNull();

      // Gọi dismissAiGhostText (hành vi khi nhấn Escape)
      const dismissed = dismissAiGhostText(view);
      expect(dismissed).toBe(true);

      // Cả 2 đều sạch sẽ
      expect(view.state.field(aiGhostTextField)).toBeNull();
      expect(view.state.field(ghostTextField)).toBeNull();
    });
  });
});
