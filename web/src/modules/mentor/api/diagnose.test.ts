import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseSqlError, extractSuggestedSql } from "./diagnose";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnose module", () => {
  describe("extractSuggestedSql", () => {
    it("trích xuất mã từ khối ```sql ... ```", () => {
      const input = "Phân tích:\n```sql\nSELECT 1;\n```\nHết.";
      expect(extractSuggestedSql(input)).toBe("SELECT 1;");
    });

    it("trích xuất mã từ khối ``` ... ``` không có tag sql", () => {
      const input = "Phân tích:\n```\nSELECT 2;\n```\nHết.";
      expect(extractSuggestedSql(input)).toBe("SELECT 2;");
    });

    it("trả về null nếu chuỗi rỗng hoặc không có code block", () => {
      expect(extractSuggestedSql("Không có code block")).toBeNull();
      expect(extractSuggestedSql("```sql\n\n```")).toBeNull();
    });
  });

  describe("diagnoseSqlError", () => {
    function createSseStream(chunks: string[]) {
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
    }

    it("gửi đúng payload và nhận SSE stream thành công", async () => {
      const onDelta = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      const fakeBody = createSseStream([
        'data: {"type":"delta","text":"Lỗi do thiếu bảng. "}\n\n',
        'data: {"type":"delta","text":"```sql\\nCREATE TABLE t(id int);\\n```"}\n\n',
        'data: {"type":"done"}\n\n',
      ]);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: fakeBody,
      });
      global.fetch = fetchMock;

      diagnoseSqlError({
        sql: "SELECT * FROM t;",
        error: "relation does not exist",
        engine: "postgres",
        locale: "vi",
        question: "sửa giúp",
        onDelta,
        onComplete,
        onError,
      });

      // Đợi stream đọc xong
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/diagnose",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sql: "SELECT * FROM t;",
            error: "relation does not exist",
            engine: "postgres",
            locale: "vi",
            question: "sửa giúp",
          }),
        }),
      );

      expect(onDelta).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledWith(
        "Lỗi do thiếu bảng. ```sql\nCREATE TABLE t(id int);\n```",
        "CREATE TABLE t(id int);",
      );
      expect(onError).not.toHaveBeenCalled();
    });

    it("xử lý lỗi quota HTTP 429", async () => {
      const onError = vi.fn();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "quota_exceeded" }),
      });

      diagnoseSqlError({
        sql: "SELECT 1;",
        error: "err",
        engine: "postgres",
        locale: "vi",
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onError).toHaveBeenCalledWith({
        messageKey: "error.quotaExceeded",
        message: undefined,
      });
    });

    it("xử lý lỗi auth HTTP 401", async () => {
      const onError = vi.fn();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "auth_required" }),
      });

      diagnoseSqlError({
        sql: "SELECT 1;",
        error: "err",
        engine: "postgres",
        locale: "vi",
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onError).toHaveBeenCalledWith({
        messageKey: "error.authRequired",
        message: undefined,
      });
    });

    it("xử lý sự kiện type error từ SSE stream", async () => {
      const onError = vi.fn();
      const fakeBody = createSseStream([
        'data: {"type":"error","messageKey":"error.aiTooLong"}\n\n',
      ]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: fakeBody,
      });

      diagnoseSqlError({
        sql: "SELECT 1;",
        error: "err",
        engine: "postgres",
        locale: "vi",
        onError,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onError).toHaveBeenCalledWith({
        messageKey: "error.aiTooLong",
      });
    });

    it("abort hủy request và không gọi onError", async () => {
      const onError = vi.fn();
      let aborted = false;

      global.fetch = vi.fn().mockImplementation((_url, init) => {
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

      const cancel = diagnoseSqlError({
        sql: "SELECT 1;",
        error: "err",
        engine: "postgres",
        locale: "vi",
        onError,
      });

      cancel();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(aborted).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
