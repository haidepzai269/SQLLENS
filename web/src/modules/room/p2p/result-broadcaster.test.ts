import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBatonStore } from "@/modules/room/collab/baton-store";
import { createRoomCollabProvider } from "@/modules/room/collab/room-provider";
import type {
  DataChannelEventLike,
  DataChannelLike,
  PeerConnectionEventLike,
  PeerConnectionLike,
  SignalEnvelope,
  WebSocketEventLike,
  WebSocketLike,
} from "@/modules/room/collab/types";
import { createResultBroadcaster } from "./result-broadcaster";
import {
  BATON_RETURN_TIMEOUT_MS,
  NAT_WARNING_TIMEOUT_MS,
  type P2pExecutionResult,
} from "./types";

function createControlBus() {
  const listeners = new Set<(message: unknown, fromPeerId: string) => void>();
  const sent: Array<{ fromPeerId: string; message: Record<string, unknown> }> = [];
  return {
    sent,
    sendControl(fromPeerId: string) {
      return (message: Record<string, unknown>) => {
        sent.push({ fromPeerId, message });
        for (const cb of listeners) {
          cb(message, fromPeerId);
        }
      };
    },
    onControl(cb: (message: unknown, fromPeerId: string) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

class MockWebSocket implements WebSocketLike {
  readyState = 0;
  private listeners = new Map<string, Set<(event: WebSocketEventLike) => void>>();

  constructor(
    readonly url: string,
    private readonly onSend: (raw: string) => void,
    private readonly onCloseCb: () => void,
  ) {}

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(raw: string): void {
    if (this.readyState !== 1) return;
    this.emit("message", { data: raw });
  }

  send(data: string): void {
    this.onSend(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onCloseCb();
    this.emit("close", { code, reason });
  }

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: WebSocketEventLike) => void,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: WebSocketEventLike) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, event: WebSocketEventLike): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
}

class MockDataChannel implements DataChannelLike {
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  binaryType: "blob" | "arraybuffer" = "arraybuffer";
  remote: MockDataChannel | null = null;
  private listeners = new Map<string, Set<(event: DataChannelEventLike) => void>>();

  constructor(readonly label: string) {}

  openBoth(): void {
    if (this.readyState === "open") return;
    this.readyState = "open";
    if (this.remote && this.remote.readyState !== "open") {
      this.remote.readyState = "open";
    }
    this.emit("open", {});
    this.remote?.emit("open", {});
  }

  send(data: Uint8Array): void {
    if (this.readyState !== "open" || !this.remote || this.remote.readyState !== "open") {
      return;
    }
    this.remote.emit("message", { data: new Uint8Array(data) });
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.emit("close", {});
    if (this.remote && this.remote.readyState !== "closed") {
      this.remote.readyState = "closed";
      this.remote.emit("close", {});
    }
  }

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: DataChannelEventLike) => void,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: DataChannelEventLike) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, event: DataChannelEventLike): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
}

class MockPeerConnection implements PeerConnectionLike {
  connectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localChannel: MockDataChannel | null = null;
  remotePeer: MockPeerConnection | null = null;
  private listeners = new Map<string, Set<(event: PeerConnectionEventLike) => void>>();

  constructor(
    readonly ownerPeerId: string,
    readonly targetPeerId: string,
    private readonly registry: Map<string, MockPeerConnection>,
  ) {
    registry.set(`${ownerPeerId}->${targetPeerId}`, this);
    const reverse = registry.get(`${targetPeerId}->${ownerPeerId}`);
    if (reverse) {
      this.remotePeer = reverse;
      reverse.remotePeer = this;
    }
  }

  createDataChannel(label: string): DataChannelLike {
    const dc = new MockDataChannel(label);
    this.localChannel = dc;
    return dc;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: `offer:${this.ownerPeerId}->${this.targetPeerId}` };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: `answer:${this.ownerPeerId}->${this.targetPeerId}` };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.signalingState = desc.type === "offer" ? "have-local-offer" : "stable";
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else {
      this.signalingState = "stable";
      this.connectChannels();
    }
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.connectionState = "closed";
    this.localChannel?.close();
  }

  addEventListener(
    type: "icecandidate" | "datachannel" | "connectionstatechange",
    listener: (event: PeerConnectionEventLike) => void,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: "icecandidate" | "datachannel" | "connectionstatechange",
    listener: (event: PeerConnectionEventLike) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  private connectChannels(): void {
    const initiator = this.localChannel ? this : this.remotePeer;
    const responder = initiator === this ? this.remotePeer : this;
    if (!initiator?.localChannel || !responder || initiator.localChannel.remote) return;

    const remoteDc = new MockDataChannel(initiator.localChannel.label);
    initiator.localChannel.remote = remoteDc;
    remoteDc.remote = initiator.localChannel;
    responder.emit("datachannel", { channel: remoteDc });
    initiator.localChannel.openBoth();
    initiator.connectionState = "connected";
    responder.connectionState = "connected";
  }

  private emit(type: string, event: PeerConnectionEventLike): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  useBatonStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  useBatonStore.getState().reset();
});

describe("ResultBroadcaster (Task166)", () => {
  it("khai báo đúng hằng số BATON_RETURN_TIMEOUT_MS = 30_000 và NAT_WARNING_TIMEOUT_MS = 10_000", () => {
    expect(BATON_RETURN_TIMEOUT_MS).toBe(30_000);
    expect(NAT_WARNING_TIMEOUT_MS).toBe(10_000);
  });

  it("tự động trả Baton về ownerId sau đúng 30_000ms khi Driver ngưng heartbeat / disconnect (AC3)", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-owner",
      myRole: "owner",
      holderId: "u-driver",
    });

    const bus = createControlBus();
    const returned = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-owner"),
      onControl: bus.onControl,
    });
    broadcaster.onBatonReturned(returned);

    broadcaster.handleDriverDisconnected();

    vi.advanceTimersByTime(29_999);
    expect(returned).not.toHaveBeenCalled();
    expect(useBatonStore.getState().holderId).toBe("u-driver");

    vi.advanceTimersByTime(1);
    expect(returned).toHaveBeenCalledTimes(1);
    expect(returned).toHaveBeenCalledWith({ type: "baton-returned", holder: "u-owner" });
    expect(useBatonStore.getState().holderId).toBe("u-owner");

    broadcaster.destroy();
  });

  it("reset bộ đếm 30_000ms khi Driver gửi heartbeat hoặc recordDriverHeartbeat() trước hạn", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-owner",
      myRole: "owner",
      holderId: "u-driver",
    });

    const bus = createControlBus();
    const returned = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-owner"),
      onControl: bus.onControl,
    });
    broadcaster.onBatonReturned(returned);

    broadcaster.recordDriverHeartbeat();
    vi.advanceTimersByTime(20_000);
    expect(returned).not.toHaveBeenCalled();

    // Nhận heartbeat qua kênh control → reset về 30_000ms tính từ mốc 20_000ms
    bus.sendControl("peer-driver")({
      type: "p2p-heartbeat",
      fromUserId: "u-driver",
      sentAt: Date.now(),
    });

    vi.advanceTimersByTime(29_999);
    expect(returned).not.toHaveBeenCalled();
    expect(useBatonStore.getState().holderId).toBe("u-driver");

    vi.advanceTimersByTime(1);
    expect(returned).toHaveBeenCalledTimes(1);
    expect(useBatonStore.getState().holderId).toBe("u-owner");

    broadcaster.destroy();
  });

  it("kích hoạt cảnh báo NAT sau đúng 10_000ms nếu chưa kết nối peer nào (AC4)", () => {
    const bus = createControlBus();
    const natSpy = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-a"),
      onControl: bus.onControl,
    });
    broadcaster.onNatWarning(natSpy);

    vi.advanceTimersByTime(9_999);
    expect(natSpy).not.toHaveBeenCalled();
    expect(broadcaster.getNatWarning()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(natSpy).toHaveBeenCalledTimes(1);
    expect(natSpy).toHaveBeenCalledWith(true);
    expect(broadcaster.getNatWarning()).toBe(true);

    broadcaster.destroy();
  });

  it("không bật cảnh báo NAT nếu có peer kết nối trước mốc 10_000ms", () => {
    const bus = createControlBus();
    const natSpy = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-a"),
      onControl: bus.onControl,
    });
    broadcaster.onNatWarning(natSpy);

    vi.advanceTimersByTime(2_000);
    broadcaster.reportPeerConnected();
    vi.advanceTimersByTime(15_000);

    expect(natSpy).not.toHaveBeenCalled();
    expect(broadcaster.getNatWarning()).toBe(false);

    broadcaster.destroy();
  });

  it("bỏ qua message lạ / payload sai định dạng trên kênh control mà không crash", () => {
    const bus = createControlBus();
    const onResultSpy = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-a"),
      onControl: bus.onControl,
    });
    broadcaster.onResult(onResultSpy);

    const emitRaw = bus.sendControl("peer-b");
    emitRaw(null as unknown as Record<string, unknown>);
    emitRaw({ type: "unknown-event", foo: 123 });
    emitRaw({ type: "p2p-result", payload: { columns: "not-array" } });
    emitRaw({ type: "baton-returned", holder: "" });

    expect(onResultSpy).not.toHaveBeenCalled();
    broadcaster.destroy();
  });

  it("destroy() huỷ sạch toàn bộ timer 10s và 30s, không gọi callback sau khi unmount", () => {
    const bus = createControlBus();
    const natSpy = vi.fn();
    const returnedSpy = vi.fn();
    const resultSpy = vi.fn();
    const broadcaster = createResultBroadcaster({
      ownerId: "u-owner",
      sendControl: bus.sendControl("peer-a"),
      onControl: bus.onControl,
    });
    broadcaster.onNatWarning(natSpy);
    broadcaster.onBatonReturned(returnedSpy);
    broadcaster.onResult(resultSpy);

    broadcaster.handleDriverDisconnected();
    broadcaster.destroy();

    vi.advanceTimersByTime(60_000);
    bus.sendControl("peer-b")({
      type: "p2p-result",
      payload: {
        columns: ["id"],
        rows: [[1]],
        rowCount: 1,
        durationMs: 5,
        tabId: "t1",
        executedBy: "u-b",
        sentAt: 1,
      },
    });

    expect(natSpy).not.toHaveBeenCalled();
    expect(returnedSpy).not.toHaveBeenCalled();
    expect(resultSpy).not.toHaveBeenCalled();
  });

  it("ghép với RoomCollabProvider: broadcastResult đi qua DataChannel và 0 byte SQL qua WebSocket /signal (AC2)", async () => {
    const signalFrames: string[] = [];
    const peers = new Map<string, MockWebSocket>();
    const pcRegistry = new Map<string, MockPeerConnection>();

    const makeWsFactory = (peerId: string, userId: string) => (url: string) => {
      const ws = new MockWebSocket(
        url,
        (raw) => {
          signalFrames.push(raw);
          const env = JSON.parse(raw) as SignalEnvelope;
          for (const [targetPeerId, targetWs] of peers.entries()) {
            if (targetPeerId === peerId) continue;
            if (env.toPeerId && env.toPeerId !== targetPeerId) continue;
            targetWs.receive(raw);
          }
        },
        () => {
          peers.delete(peerId);
        },
      );
      peers.set(peerId, ws);
      void userId;
      queueMicrotask(() => ws.open());
      return ws;
    };

    const providerA = createRoomCollabProvider({
      projectId: "proj-p2p",
      userId: "u-a",
      peerId: "peer-1",
      webSocketFactory: makeWsFactory("peer-1", "u-a"),
      peerConnectionFactory: (remotePeerId) =>
        new MockPeerConnection("peer-1", remotePeerId, pcRegistry),
    });

    const providerB = createRoomCollabProvider({
      projectId: "proj-p2p",
      userId: "u-b",
      peerId: "peer-2",
      webSocketFactory: makeWsFactory("peer-2", "u-b"),
      peerConnectionFactory: (remotePeerId) =>
        new MockPeerConnection("peer-2", remotePeerId, pcRegistry),
    });

    providerA.connect();
    providerB.connect();

    await vi.advanceTimersByTimeAsync(50);

    const broadcasterA = createResultBroadcaster({
      ownerId: "u-a",
      sendControl: providerA.sendControl,
      onControl: providerA.onControl,
    });
    const broadcasterB = createResultBroadcaster({
      ownerId: "u-a",
      sendControl: providerB.sendControl,
      onControl: providerB.onControl,
    });

    const received: P2pExecutionResult[] = [];
    broadcasterB.onResult((res) => received.push(res));

    const sampleResult: P2pExecutionResult = {
      columns: ["secret_sql_col", "amount"],
      rows: [["SELECT * FROM payroll_secret", 99999]],
      rowCount: 1,
      durationMs: 14,
      tabId: "tab-secret",
      executedBy: "u-a",
      sentAt: 1700000000000,
    };

    broadcasterA.broadcastResult(sampleResult);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sampleResult);

    // Khẳng định tuyệt đối 0 byte SQL hay payload kết quả đi qua WebSocket /signal
    const joinedSignal = signalFrames.join("\n");
    expect(joinedSignal).not.toContain("p2p-result");
    expect(joinedSignal).not.toContain("secret_sql_col");
    expect(joinedSignal).not.toContain("payroll_secret");
    expect(joinedSignal).not.toContain("99999");

    broadcasterA.destroy();
    broadcasterB.destroy();
    providerA.destroy();
    providerB.destroy();
  });
});
