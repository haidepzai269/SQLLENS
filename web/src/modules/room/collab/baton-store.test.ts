import { describe, expect, it, vi } from "vitest";
import { createBatonStore, type BatonTransport } from "./baton-store";
import type { BatonControlMessage } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("baton-store (The Baton)", () => {
  it("AC5.1: syncFromServer() gọi GET /baton và cập nhật holderId + status", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return jsonResponse(200, {
        holderId: "user-owner",
        step: 2,
        updatedAt: "2026-11-25T10:00:00Z",
      });
    }) as typeof fetch;

    const store = createBatonStore({ fetchImpl });
    store.getState().setRoom({
      projectId: "proj-1",
      myUserId: "user-editor",
      myRole: "editor",
    });

    await store.getState().syncFromServer();

    expect(calls).toEqual([
      { url: "/api/v1/cloud/projects/proj-1/baton", method: "GET" },
    ]);
    expect(store.getState().holderId).toBe("user-owner");
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeNull();
  });

  it("AC5.2: claimBaton() gọi POST /baton/claim và xóa holder mới khỏi pendingRequests", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return jsonResponse(200, {
        holderId: "user-owner",
        step: 0,
        updatedAt: "2026-11-25T10:01:00Z",
      });
    }) as typeof fetch;

    const store = createBatonStore({ fetchImpl });
    store.getState().setRoom({
      projectId: "proj-1",
      myUserId: "user-owner",
      myRole: "owner",
      holderId: "user-editor",
    });
    store.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-1",
      fromUserId: "user-owner",
      sentAt: 100,
    });

    const ok = await store.getState().claimBaton();

    expect(ok).toBe(true);
    expect(calls).toEqual([
      { url: "/api/v1/cloud/projects/proj-1/baton/claim", method: "POST" },
    ]);
    expect(store.getState().holderId).toBe("user-owner");
    expect(store.getState().pendingRequests).toEqual([]);
    expect(store.getState().status).toBe("ready");
  });

  it("AC5.3: requestBaton(), grantBaton(), returnBaton() phát control message và cập nhật state", async () => {
    const sent: BatonControlMessage[] = [];
    const transport: BatonTransport = {
      sendControl: (msg) => {
        sent.push(msg);
      },
    };
    const store = createBatonStore({ transport, now: () => 1700000000123 });

    store.getState().setRoom({
      projectId: "proj-2",
      myUserId: "user-editor",
      myRole: "editor",
      holderId: "user-owner",
    });
    expect(await store.getState().requestBaton()).toBe(true);
    expect(store.getState().pendingRequests).toEqual(["user-editor"]);
    expect(sent[0]).toEqual({
      kind: "baton:request",
      roomId: "proj-2",
      fromUserId: "user-editor",
      sentAt: 1700000000123,
    });

    // Chuyển sang góc nhìn owner cấp quyền cho user-editor
    store.getState().setRoom({
      projectId: "proj-2",
      myUserId: "user-owner",
      myRole: "owner",
      holderId: "user-owner",
    });
    expect(await store.getState().grantBaton("user-editor")).toBe(true);
    expect(store.getState().holderId).toBe("user-editor");
    expect(store.getState().pendingRequests).toEqual([]);
    expect(sent[1]).toEqual({
      kind: "baton:grant",
      roomId: "proj-2",
      fromUserId: "user-owner",
      targetUserId: "user-editor",
      sentAt: 1700000000123,
    });

    expect(await store.getState().returnBaton()).toBe(true);
    expect(store.getState().holderId).toBeNull();
    expect(sent[2]).toEqual({
      kind: "baton:return",
      roomId: "proj-2",
      fromUserId: "user-owner",
      sentAt: 1700000000123,
    });
  });

  it("AC5.4: applyControlMessage cập nhật trạng thái từ peer khác và bỏ qua message sai phòng", () => {
    const store = createBatonStore();
    store.getState().setRoom({
      projectId: "proj-3",
      myUserId: "user-owner",
      myRole: "owner",
      holderId: "user-owner",
    });

    store.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "other-proj",
      fromUserId: "user-2",
      sentAt: 1,
    });
    expect(store.getState().pendingRequests).toEqual([]);

    store.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-3",
      fromUserId: "user-2",
      sentAt: 2,
    });
    store.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-3",
      fromUserId: "user-2",
      sentAt: 3,
    });
    expect(store.getState().pendingRequests).toEqual(["user-2"]);

    store.getState().applyControlMessage({
      kind: "baton:grant",
      roomId: "proj-3",
      fromUserId: "user-owner",
      targetUserId: "user-2",
      sentAt: 4,
    });
    expect(store.getState().holderId).toBe("user-2");
    expect(store.getState().pendingRequests).toEqual([]);

    store.getState().applyControlMessage({
      kind: "baton:return",
      roomId: "proj-3",
      fromUserId: "user-2",
      sentAt: 5,
    });
    expect(store.getState().holderId).toBeNull();
  });

  it("Ca biên: chặn hoàn toàn vai trò viewer đối với claimBaton, requestBaton, grantBaton và returnBaton", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { holderId: "user-viewer" }));
    const sendControlSpy = vi.fn();
    const store = createBatonStore({
      fetchImpl: fetchSpy as unknown as typeof fetch,
      transport: { sendControl: sendControlSpy },
    });

    store.getState().setRoom({
      projectId: "proj-v",
      myUserId: "user-viewer",
      myRole: "viewer",
      holderId: "user-owner",
    });

    expect(await store.getState().claimBaton()).toBe(false);
    expect(await store.getState().requestBaton()).toBe(false);
    expect(await store.getState().grantBaton("user-viewer")).toBe(false);
    expect(await store.getState().returnBaton()).toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendControlSpy).not.toHaveBeenCalled();
    expect(store.getState().holderId).toBe("user-owner");
    expect(store.getState().pendingRequests).toEqual([]);
  });

  it("Ca biên: xử lý lỗi HTTP khi syncFromServer hoặc claimBaton thất bại", async () => {
    const fetchImpl = (async () =>
      jsonResponse(403, { error: { code: "forbidden", messageKey: "error.forbidden" } })) as typeof fetch;

    const store = createBatonStore({ fetchImpl });
    store.getState().setRoom({
      projectId: "proj-err",
      myUserId: "user-editor",
      myRole: "editor",
    });

    const claimed = await store.getState().claimBaton();
    expect(claimed).toBe(false);
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toContain("403: forbidden");

    store.getState().reset();
    expect(store.getState().projectId).toBeNull();
    expect(store.getState().status).toBe("idle");
  });
});
