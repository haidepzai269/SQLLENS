/**
 * Copyright (c) 2026 SQLLens
 * Unit tests for VIP AI Copilot API Client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiInlineCompletion } from "./copilot-client";

describe("fetchAiInlineCompletion API client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("gọi POST /api/ai/inline-complete thành công và trả về completion", async () => {
    const mockResponse = {
      completion: "SELECT * FROM orders WHERE status = 'completed';",
      finishReason: "stop",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const promise = fetchAiInlineCompletion({
      prefix: "SELECT * FROM orders",
      suffix: "",
      engine: "postgres",
      schemaSnippet: "orders(id, status)",
    });

    const result = await promise;

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/ai/inline-complete",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: "SELECT * FROM orders",
          suffix: "",
          engine: "postgres",
          schemaSnippet: "orders(id, status)",
        }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it("trả về { completion: '', finishReason: 'error' } khi server trả về 403 vip_required", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: "vip_required" } }),
    });

    const result = await fetchAiInlineCompletion({
      prefix: "SELECT 1;",
    });

    expect(result).toEqual({ completion: "", finishReason: "error" });
  });

  it("trả về { completion: '', finishReason: 'error' } khi server trả về 500 lỗi máy chủ", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "internal" } }),
    });

    const result = await fetchAiInlineCompletion({
      prefix: "SELECT 1;",
    });

    expect(result).toEqual({ completion: "", finishReason: "error" });
  });

  it("trả về { completion: '', finishReason: 'error' } khi gặp lỗi kết nối mạng (Network Error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch (offline)"));

    const result = await fetchAiInlineCompletion({
      prefix: "SELECT 1;",
    });

    expect(result).toEqual({ completion: "", finishReason: "error" });
  });

  it("trả về null khi signal ngoài đã bị aborted trước khi gọi", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await fetchAiInlineCompletion({
      prefix: "SELECT 1;",
      signal: controller.signal,
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trả về null khi signal ngoài bị hủy trong lúc đang gọi API", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            const err = new DOMException("The user aborted a request.", "AbortError");
            reject(err);
          });
        }
      });
    });

    const promise = fetchAiInlineCompletion({
      prefix: "SELECT 1;",
      signal: controller.signal,
    });

    controller.abort();
    const result = await promise;

    expect(result).toBeNull();
  });
});
