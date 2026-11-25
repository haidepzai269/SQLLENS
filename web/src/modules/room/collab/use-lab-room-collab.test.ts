import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { P2pExecutionResult, ResultBroadcaster } from "../p2p/types";
import { useBatonStore } from "./baton-store";
import type { RoomCollabProvider } from "./types";
import { useLabRoomCollab } from "./use-lab-room-collab";

function createFakeProvider() {
  const doc = new Y.Doc();
  const controlListeners = new Set<(message: unknown, fromPeerId: string) => void>();
  const awarenessListeners = new Set<() => void>();
  let peerIds: string[] = [];
  const states = new Map<number, Record<string, unknown>>([[1, {}]]);

  const awareness = {
    getStates: () => states,
    on: (_event: string, cb: () => void) => {
      awarenessListeners.add(cb);
    },
    off: (_event: string, cb: () => void) => {
      awarenessListeners.delete(cb);
    },
  } as unknown as RoomCollabProvider["awareness"];

  const sendControl = vi.fn();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const destroy = vi.fn();

  const provider: RoomCollabProvider = {
    doc,
    awareness,
    peerId: "peer-local",
    connect,
    disconnect,
    destroy,
    sendControl,
    onControl(cb) {
      controlListeners.add(cb);
      return () => controlListeners.delete(cb);
    },
    getPeerIds: () => peerIds,
  };

  return {
    provider,
    sendControl,
    connect,
    destroy,
    emitControl(msg: unknown, fromPeerId = "peer-remote") {
      for (const cb of controlListeners) cb(msg, fromPeerId);
    },
    simulateRemotePeerJoin() {
      peerIds = ["peer-remote"];
      states.set(2, {});
      for (const cb of awarenessListeners) cb();
    },
  };
}

function createFakeBroadcaster() {
  const resultListeners = new Set<(res: P2pExecutionResult, fromPeerId: string) => void>();
  const natListeners = new Set<(warning: boolean) => void>();
  const broadcastResult = vi.fn();
  const reportPeerConnected = vi.fn();
  const destroy = vi.fn();

  const broadcaster: ResultBroadcaster = {
    broadcastResult,
    onResult(cb) {
      resultListeners.add(cb);
      return () => resultListeners.delete(cb);
    },
    recordDriverHeartbeat: vi.fn(),
    handleDriverDisconnected: vi.fn(),
    sendHeartbeat: vi.fn(),
    onBatonReturned: () => () => {},
    reportPeerConnected,
    reportIceFailed: vi.fn(),
    onNatWarning(cb) {
      natListeners.add(cb);
      return () => natListeners.delete(cb);
    },
    getNatWarning: () => false,
    destroy,
  };

  return {
    broadcaster,
    broadcastResult,
    reportPeerConnected,
    destroy,
    emitNatWarning(visible: boolean) {
      for (const cb of natListeners) cb(visible);
    },
    emitRemoteResult(res: P2pExecutionResult, fromPeerId = "peer-remote") {
      for (const cb of resultListeners) cb(res, fromPeerId);
    },
  };
}

function createMembersFetchMock(
  members: Array<{ userId: string; name: string; role: string }>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/members")) {
      return new Response(JSON.stringify({ members }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/baton")) {
      return new Response(JSON.stringify({ holderId: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  useBatonStore.getState().reset();
  useBatonStore.getState().setTransport(null);
  vi.restoreAllMocks();
});

describe("useLabRoomCollab", () => {
  it("AC1: dự án local thường (remoteProjectId = null) -> 0 network call, collabExtension = null", () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const createProvider = vi.fn();
    const createBroadcaster = vi.fn();

    const { result } = renderHook(() =>
      useLabRoomCollab({
        remoteProjectId: null,
        activeTabId: "tab-1",
        userId: "u-1",
        deps: {
          fetchImpl: fetchMock,
          createProvider: createProvider as never,
          createBroadcaster: createBroadcaster as never,
        },
      }),
    );

    expect(result.current.collabExtension).toBeNull();
    expect(result.current.broadcastResult).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(createBroadcaster).not.toHaveBeenCalled();
    expect(useBatonStore.getState().projectId).toBeNull();
  });

  it("AC2: dự án có remoteId -> gọi /members, set baton-store, nối provider + broadcaster, viewer readOnly=true", async () => {
    const fetchMock = createMembersFetchMock([
      { userId: "u-owner", name: "Alice", role: "owner" },
      { userId: "u-viewer", name: "Bob", role: "viewer" },
    ]);
    const fakeProv = createFakeProvider();
    const fakeBc = createFakeBroadcaster();
    const createTabExtension = vi.fn(() => []);

    const { result } = renderHook(() =>
      useLabRoomCollab({
        remoteProjectId: "proj-1",
        activeTabId: "tab-1",
        userId: "u-viewer",
        deps: {
          fetchImpl: fetchMock,
          createProvider: () => fakeProv.provider,
          createBroadcaster: () => fakeBc.broadcaster,
          createTabExtension,
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.collabExtension).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/cloud/projects/proj-1/members",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(fakeProv.connect).toHaveBeenCalledTimes(1);
    expect(useBatonStore.getState().projectId).toBe("proj-1");
    expect(useBatonStore.getState().myRole).toBe("viewer");
    expect(useBatonStore.getState().memberNames).toEqual({
      "u-owner": "Alice",
      "u-viewer": "Bob",
    });
    expect(createTabExtension).toHaveBeenCalledWith(
      fakeProv.provider.doc,
      "tab-1",
      fakeProv.provider.awareness,
      { readOnly: true },
    );
  });

  it("AC3: luồng Baton request/grant/return đi 100% qua provider.sendControl, 0 REST call tới /baton/request|grant|heartbeat", async () => {
    const fetchMock = createMembersFetchMock([
      { userId: "u-owner", name: "Alice", role: "owner" },
      { userId: "u-editor", name: "Carol", role: "editor" },
    ]);
    const fakeProv = createFakeProvider();
    const fakeBc = createFakeBroadcaster();
    const globalFetchSpy = vi.spyOn(globalThis, "fetch");

    const { result } = renderHook(() =>
      useLabRoomCollab({
        remoteProjectId: "proj-2",
        activeTabId: "tab-1",
        userId: "u-editor",
        deps: {
          fetchImpl: fetchMock,
          createProvider: () => fakeProv.provider,
          createBroadcaster: () => fakeBc.broadcaster,
          createTabExtension: () => [],
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.broadcastResult).not.toBeNull();
    });

    await act(async () => {
      await useBatonStore.getState().requestBaton();
    });

    expect(fakeProv.sendControl).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "baton:request",
        roomId: "proj-2",
        fromUserId: "u-editor",
      }),
    );

    act(() => {
      fakeProv.emitControl({
        kind: "baton:grant",
        roomId: "proj-2",
        fromUserId: "u-owner",
        targetUserId: "u-editor",
        sentAt: Date.now(),
      });
    });

    expect(useBatonStore.getState().holderId).toBe("u-editor");

    await act(async () => {
      await useBatonStore.getState().returnBaton();
    });

    expect(fakeProv.sendControl).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "baton:return",
        roomId: "proj-2",
        fromUserId: "u-editor",
      }),
    );
    expect(useBatonStore.getState().holderId).toBeNull();

    const calledUrls = globalFetchSpy.mock.calls.map(([u]) => String(u));
    expect(calledUrls.some((u) => /\/baton\/(request|grant|heartbeat)/.test(u))).toBe(false);
  });

  it("AC4: natWarning đồng bộ vào baton-store và cleanup gọi destroy() + reset()", async () => {
    const fetchMock = createMembersFetchMock([
      { userId: "u-owner", name: "Alice", role: "owner" },
    ]);
    const fakeProv = createFakeProvider();
    const fakeBc = createFakeBroadcaster();
    const onRemoteResult = vi.fn();

    const { result, unmount } = renderHook(() =>
      useLabRoomCollab({
        remoteProjectId: "proj-3",
        activeTabId: "tab-1",
        userId: "u-owner",
        onRemoteResult,
        deps: {
          fetchImpl: fetchMock,
          createProvider: () => fakeProv.provider,
          createBroadcaster: () => fakeBc.broadcaster,
          createTabExtension: () => [],
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.broadcastResult).not.toBeNull();
    });

    act(() => {
      fakeBc.emitNatWarning(true);
    });
    expect(useBatonStore.getState().natWarning).toBe(true);

    act(() => {
      fakeProv.simulateRemotePeerJoin();
    });
    expect(fakeBc.reportPeerConnected).toHaveBeenCalled();

    act(() => {
      fakeBc.emitNatWarning(false);
    });
    expect(useBatonStore.getState().natWarning).toBe(false);

    const sampleResult: P2pExecutionResult = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      durationMs: 12,
      tabId: "tab-1",
      executedBy: "u-owner",
      sentAt: 1000,
    };

    act(() => {
      result.current.broadcastResult?.(sampleResult);
      fakeBc.emitRemoteResult(sampleResult);
    });
    expect(fakeBc.broadcastResult).toHaveBeenCalledWith(sampleResult);
    expect(onRemoteResult).toHaveBeenCalledWith(sampleResult);

    unmount();

    expect(fakeBc.destroy).toHaveBeenCalledTimes(1);
    expect(fakeProv.destroy).toHaveBeenCalledTimes(1);
    expect(useBatonStore.getState().projectId).toBeNull();
  });
});
