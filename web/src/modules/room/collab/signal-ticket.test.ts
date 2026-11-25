import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDirectSignalUrl, requestSignalTicket } from "./signal-ticket";

describe("signal-ticket", () => {
  const originalEnv = process.env.NEXT_PUBLIC_WS_ORIGIN;
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_WS_ORIGIN;
    } else {
      process.env.NEXT_PUBLIC_WS_ORIGIN = originalEnv;
    }
    if (originalWindow === undefined) {
      // @ts-expect-error cleanup test window mock
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it("buildDirectSignalUrl chuẩn hóa NEXT_PUBLIC_WS_ORIGIN (https/http/wss và trailing slash) và gắn ticket", () => {
    process.env.NEXT_PUBLIC_WS_ORIGIN = "https://sqllens.onrender.com/";
    expect(buildDirectSignalUrl("proj-1", "tk_abc")).toBe(
      "wss://sqllens.onrender.com/api/v1/cloud/projects/proj-1/signal?ticket=tk_abc",
    );

    process.env.NEXT_PUBLIC_WS_ORIGIN = "http://localhost:8080///";
    expect(buildDirectSignalUrl("proj-1", "tk_abc")).toBe(
      "ws://localhost:8080/api/v1/cloud/projects/proj-1/signal?ticket=tk_abc",
    );

    expect(buildDirectSignalUrl("proj-1", undefined, "wss://custom.example.com/")).toBe(
      "wss://custom.example.com/api/v1/cloud/projects/proj-1/signal",
    );
  });

  it("buildDirectSignalUrl fallback về window.location khi NEXT_PUBLIC_WS_ORIGIN rỗng", () => {
    delete process.env.NEXT_PUBLIC_WS_ORIGIN;
    globalThis.window = {
      location: {
        protocol: "https:",
        host: "sqllens.vercel.app",
      } as Location,
    } as unknown as Window & typeof globalThis;
    expect(buildDirectSignalUrl("proj-2", "tk_xyz")).toBe(
      "wss://sqllens.vercel.app/api/v1/cloud/projects/proj-2/signal?ticket=tk_xyz",
    );

    globalThis.window = {
      location: {
        protocol: "http:",
        host: "localhost:3000",
      } as Location,
    } as unknown as Window & typeof globalThis;
    expect(buildDirectSignalUrl("proj-2")).toBe(
      "ws://localhost:3000/api/v1/cloud/projects/proj-2/signal",
    );
  });

  it("requestSignalTicket trả ticket khi 200 và ném lỗi rõ ràng khi 401/404/payload lỗi", async () => {
    const okFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ticket: "tk_123", expiresIn: 30 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await requestSignalTicket("proj-1", okFetch);
    expect(res).toEqual({ ticket: "tk_123", expiresIn: 30 });
    expect(okFetch).toHaveBeenCalledWith(
      "/api/v1/cloud/projects/proj-1/signal-ticket",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );

    const unauthFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "auth_required" }), { status: 401 }),
    );
    await expect(requestSignalTicket("proj-1", unauthFetch)).rejects.toThrow("HTTP 401");

    const notFoundFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    await expect(requestSignalTicket("proj-1", notFoundFetch)).rejects.toThrow("HTTP 404");

    const badPayloadFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ expiresIn: 30 }), { status: 200 }),
    );
    await expect(requestSignalTicket("proj-1", badPayloadFetch)).rejects.toThrow("missing ticket");
  });
});
