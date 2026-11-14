/**
 * Copyright (c) 2026 SQLLens
 * Unit & Integration tests for CodeMirror 6 AI Copilot Multi-line Ghost Text Extension.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
});
