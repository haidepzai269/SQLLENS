import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createRoomCollabProvider } from "./room-provider";
import type {
  DataChannelEventLike,
  DataChannelLike,
  PeerConnectionEventLike,
  PeerConnectionLike,
  SignalEnvelope,
  WebSocketEventLike,
  WebSocketLike,
} from "./types";

class MockWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  private listeners = new Map<string, Set<(event: WebSocketEventLike) => void>>();

  constructor(
    readonly url: string,
    private readonly onSend: (raw: string) => void,
    private readonly onCloseCb: () => void,
  ) {}

  open(): void {
    this.readyState = 1; // OPEN
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
    const copy = new Uint8Array(data);
    this.remote.emit("message", { data: copy });
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
  iceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localChannel: MockDataChannel | null = null;
  remotePeer: MockPeerConnection | null = null;
  closed = false;
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
    return {
      type: "offer",
      sdp: `mock-offer:${this.ownerPeerId}->${this.targetPeerId}`,
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: "answer",
      sdp: `mock-answer:${this.ownerPeerId}->${this.targetPeerId}`,
    };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (desc.type === "offer") {
      this.signalingState = "have-local-offer";
    } else if (desc.type === "answer") {
      this.signalingState = "stable";
    }
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else if (desc.type === "answer") {
      this.signalingState = "stable";
      this.connectChannelsIfReady();
    }
  }

  async addIceCandidate(): Promise<void> {
    // No-op in mock mesh.
  }

  close(): void {
    this.closed = true;
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

  private connectChannelsIfReady(): void {
    const initiator = this.localChannel ? this : this.remotePeer;
    const responder = initiator === this ? this.remotePeer : this;
    if (!initiator?.localChannel || !responder) return;
    if (initiator.localChannel.remote) return;

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

interface HubEntry {
  peerId: string;
  userId: string;
  ws: MockWebSocket;
}

/**
 * Hub giả lập đúng hành vi `/signal` của Task163 (`room_signal.go`):
 * - Ghi nhận mọi payload đi qua `/signal` để kiểm 0 byte SQL.
 * - Khi có `to`, relay tới MỌI tab của `to` (D3).
 */
function createMockSignalHub() {
  const sockets: HubEntry[] = [];
  const sentFrames: string[] = [];
  const pcRegistry = new Map<string, MockPeerConnection>();

  const attachPeer = (peerId: string, userId: string) => {
    let currentWs: MockWebSocket | null = null;
    return {
      webSocketFactory: (url: string) => {
        const ws = new MockWebSocket(
          url,
          (raw) => {
            sentFrames.push(raw);
            const parsed = JSON.parse(raw) as SignalEnvelope;
            for (const target of sockets) {
              if (target.ws === ws) continue;
              if (parsed.to && target.userId !== parsed.to) continue;
              target.ws.receive(raw);
            }
          },
          () => {
            const idx = sockets.findIndex((s) => s.ws === ws);
            if (idx >= 0) sockets.splice(idx, 1);
          },
        );
        currentWs = ws;
        sockets.push({ peerId, userId, ws });
        return ws;
      },
      peerConnectionFactory: (remotePeerId: string) =>
        new MockPeerConnection(peerId, remotePeerId, pcRegistry),
      openSocket: () => currentWs?.open(),
      getSocket: () => currentWs,
    };
  };

  return { attachPeer, sentFrames, pcRegistry, sockets };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createRoomCollabProvider", () => {
  it("AC1: 2 Y.Doc hội tụ sau chỉnh sửa xung đột và gửi 0 byte SQL qua WebSocket /signal", async () => {
    const hub = createMockSignalHub();
    const netA = hub.attachPeer("peer-a", "user-a");
    const netB = hub.attachPeer("peer-b", "user-b");

    const providerA = createRoomCollabProvider({
      projectId: "room-1",
      userId: "user-a",
      peerId: "peer-a",
      webSocketFactory: netA.webSocketFactory,
      peerConnectionFactory: netA.peerConnectionFactory,
    });
    const providerB = createRoomCollabProvider({
      projectId: "room-1",
      userId: "user-b",
      peerId: "peer-b",
      webSocketFactory: netB.webSocketFactory,
      peerConnectionFactory: netB.peerConnectionFactory,
    });

    providerA.connect();
    netA.openSocket();
    providerB.connect();
    netB.openSocket();
    await flushMicrotasks();

    expect(providerA.getPeerIds()).toEqual(["peer-b"]);
    expect(providerB.getPeerIds()).toEqual(["peer-a"]);

    const textA = providerA.doc.getText("tab:t1");
    const textB = providerB.doc.getText("tab:t1");

    // Chèn ban đầu và chèn/xóa xung đột đồng thời
    textA.insert(0, "SELECT id, name FROM users;");
    await flushMicrotasks();
    expect(textB.toString()).toBe("SELECT id, name FROM users;");

    // Tách biệt trong transaction cục bộ: sửa đồng thời ở cùng vị trí
    Y.transact(providerA.doc, () => {
      textA.delete(7, 4);
      textA.insert(7, "email, ");
    });
    Y.transact(providerB.doc, () => {
      textB.insert(textB.length, " WHERE active = true;");
    });
    await flushMicrotasks();

    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain("email");
    expect(textA.toString()).toContain("WHERE active = true;");

    // Kiểm tra tuyệt đối 0 byte SQL đi qua WebSocket /signal
    expect(hub.sentFrames.length).toBeGreaterThan(0);
    for (const frame of hub.sentFrames) {
      expect(frame).not.toContain("SELECT");
      expect(frame).not.toContain("users");
      expect(frame).not.toContain("email");
      expect(frame).not.toContain("WHERE");
    }

    providerA.destroy();
    providerB.destroy();
  });

  it("AC3 (D3): 2 tab cùng userId nhận broadcast từ server nhưng chỉ tab khớp toPeerId mới xử lý offer", async () => {
    const hub = createMockSignalHub();
    const tab1 = hub.attachPeer("peer-1", "shared-user");
    const tab2 = hub.attachPeer("peer-2", "shared-user");

    const peer1OfferSpy = vi.fn(async (_sdp?: string) => ({ type: "answer" as const, sdp: "ans-1" }));
    const peer2OfferSpy = vi.fn(async (_sdp?: string) => ({ type: "answer" as const, sdp: "ans-2" }));

    const p1 = createRoomCollabProvider({
      projectId: "room-d3",
      userId: "shared-user",
      peerId: "peer-1",
      webSocketFactory: tab1.webSocketFactory,
      peerConnectionFactory: (remotePeerId) => {
        const pc = tab1.peerConnectionFactory(remotePeerId);
        const origSetRemote = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async (desc) => {
          if (desc.type === "offer") await peer1OfferSpy(desc.sdp);
          return origSetRemote(desc);
        };
        return pc;
      },
    });

    const p2 = createRoomCollabProvider({
      projectId: "room-d3",
      userId: "shared-user",
      peerId: "peer-2",
      webSocketFactory: tab2.webSocketFactory,
      peerConnectionFactory: (remotePeerId) => {
        const pc = tab2.peerConnectionFactory(remotePeerId);
        const origSetRemote = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async (desc) => {
          if (desc.type === "offer") await peer2OfferSpy(desc.sdp);
          return origSetRemote(desc);
        };
        return pc;
      },
    });

    p1.connect();
    tab1.openSocket();
    p2.connect();
    tab2.openSocket();
    await flushMicrotasks();

    // Xóa bộ đếm offer và frames khởi tạo giữa peer-1 và peer-2 trước khi kiểm tra offer từ peer-3.
    peer1OfferSpy.mockClear();
    peer2OfferSpy.mockClear();
    hub.sentFrames.length = 0;

    // Giả lập peer-3 gửi offer với `to: "shared-user"` và `toPeerId: "peer-1"`.
    // Theo D3 (`room_signal.go`), server relay tới cả tab1 và tab2.
    const offerFromPeer3 = JSON.stringify({
      type: "offer",
      roomId: "room-d3",
      fromPeerId: "peer-3",
      fromUserId: "other-user",
      toPeerId: "peer-1",
      to: "shared-user",
      payload: { type: "offer", sdp: "mock-offer:peer-3->peer-1" },
    } satisfies SignalEnvelope);

    tab1.getSocket()?.receive(offerFromPeer3);
    tab2.getSocket()?.receive(offerFromPeer3);
    await flushMicrotasks();

    expect(peer1OfferSpy).toHaveBeenCalledTimes(1);
    expect(peer2OfferSpy).not.toHaveBeenCalled();
    expect(p1.getPeerIds()).toContain("peer-3");
    expect(p2.getPeerIds()).not.toContain("peer-3");

    const answerFrames = hub.sentFrames
      .map((raw) => JSON.parse(raw) as SignalEnvelope)
      .filter((env) => env.type === "answer");
    expect(answerFrames).toHaveLength(1);
    expect(answerFrames[0].fromPeerId).toBe("peer-1");
    expect(answerFrames[0].toPeerId).toBe("peer-3");

    p1.destroy();
    p2.destroy();
  });

  it("chuyển tiếp control message (Baton) qua DataChannel và không lọt ra /signal", async () => {
    const hub = createMockSignalHub();
    const netA = hub.attachPeer("peer-1", "user-1");
    const netB = hub.attachPeer("peer-2", "user-2");

    const providerA = createRoomCollabProvider({
      projectId: "room-ctrl",
      userId: "user-1",
      peerId: "peer-1",
      webSocketFactory: netA.webSocketFactory,
      peerConnectionFactory: netA.peerConnectionFactory,
    });
    const providerB = createRoomCollabProvider({
      projectId: "room-ctrl",
      userId: "user-2",
      peerId: "peer-2",
      webSocketFactory: netB.webSocketFactory,
      peerConnectionFactory: netB.peerConnectionFactory,
    });

    const received: Array<{ msg: unknown; fromPeerId: string }> = [];
    const unsubscribe = providerB.onControl((msg, fromPeerId) => {
      received.push({ msg, fromPeerId });
    });

    providerA.connect();
    netA.openSocket();
    providerB.connect();
    netB.openSocket();
    await flushMicrotasks();

    const framesBefore = hub.sentFrames.length;
    const msg = {
      kind: "baton:request" as const,
      roomId: "room-ctrl",
      fromUserId: "user-1",
      sentAt: 1700000000000,
    };
    providerA.sendControl(msg);

    expect(received).toEqual([{ msg, fromPeerId: "peer-1" }]);
    expect(hub.sentFrames.length).toBe(framesBefore);

    unsubscribe();
    providerA.sendControl({ kind: "baton:return", roomId: "room-ctrl", fromUserId: "user-1", sentAt: 1 });
    expect(received).toHaveLength(1);

    providerA.destroy();
    providerB.destroy();
  });

  it("Ca biên: xử lý glare offer đồng thời tất định theo localPeerId < remotePeerId", async () => {
    const hub = createMockSignalHub();
    const net1 = hub.attachPeer("peer-1", "user-1");
    const net2 = hub.attachPeer("peer-2", "user-2");

    const p1 = createRoomCollabProvider({
      projectId: "room-glare",
      userId: "user-1",
      peerId: "peer-1",
      webSocketFactory: net1.webSocketFactory,
      peerConnectionFactory: net1.peerConnectionFactory,
    });
    const p2 = createRoomCollabProvider({
      projectId: "room-glare",
      userId: "user-2",
      peerId: "peer-2",
      webSocketFactory: net2.webSocketFactory,
      peerConnectionFactory: net2.peerConnectionFactory,
    });

    p1.connect();
    net1.openSocket();
    p2.connect();
    net2.openSocket();
    await flushMicrotasks();

    // Ép cả 2 peer rơi vào trạng thái đang có local offer (glare thực sự)
    const pc1 = hub.pcRegistry.get("peer-1->peer-2")!;
    const pc2 = hub.pcRegistry.get("peer-2->peer-1")!;
    pc1.signalingState = "have-local-offer";
    pc2.signalingState = "have-local-offer";
    pc2.localChannel = new MockDataChannel("sqllens-collab");

    // Cả hai nhận offer của nhau trong lúc have-local-offer
    net1.getSocket()?.receive(
      JSON.stringify({
        type: "offer",
        roomId: "room-glare",
        fromPeerId: "peer-2",
        fromUserId: "user-2",
        toPeerId: "peer-1",
        to: "user-1",
        payload: { type: "offer", sdp: "glare-from-2" },
      } satisfies SignalEnvelope),
    );
    net2.getSocket()?.receive(
      JSON.stringify({
        type: "offer",
        roomId: "room-glare",
        fromPeerId: "peer-1",
        fromUserId: "user-1",
        toPeerId: "peer-2",
        to: "user-2",
        payload: { type: "offer", sdp: "glare-from-1" },
      } satisfies SignalEnvelope),
    );
    await flushMicrotasks();

    // peer-1 (nhỏ hơn) thắng: giữ local offer; peer-2 (lớn hơn) nhường và nhận channel của peer-1
    expect(pc1.signalingState).toBe("stable");
    expect(pc2.signalingState).toBe("stable");

    p1.doc.getText("tab:g").insert(0, "SELECT 99;");
    await flushMicrotasks();
    expect(p2.doc.getText("tab:g").toString()).toBe("SELECT 99;");

    p1.destroy();
    p2.destroy();
  });

  it("Ca biên: dọn RTCPeerConnection và xóa awareness state khi nhận leave hoặc DataChannel đóng", async () => {
    const hub = createMockSignalHub();
    const netA = hub.attachPeer("peer-a", "user-a");
    const netB = hub.attachPeer("peer-b", "user-b");

    const pA = createRoomCollabProvider({
      projectId: "room-leave",
      userId: "user-a",
      peerId: "peer-a",
      webSocketFactory: netA.webSocketFactory,
      peerConnectionFactory: netA.peerConnectionFactory,
    });
    const pB = createRoomCollabProvider({
      projectId: "room-leave",
      userId: "user-b",
      peerId: "peer-b",
      webSocketFactory: netB.webSocketFactory,
      peerConnectionFactory: netB.peerConnectionFactory,
    });

    pA.awareness.setLocalState({ name: "Alice" });
    pB.awareness.setLocalState({ name: "Bob" });

    pA.connect();
    netA.openSocket();
    pB.connect();
    netB.openSocket();
    await flushMicrotasks();

    expect(pA.awareness.getStates().has(pB.doc.clientID)).toBe(true);

    // Đóng đột ngột từ phía B thông qua disconnect() -> gửi leave + đóng DataChannel
    pB.disconnect();
    await flushMicrotasks();

    expect(pA.getPeerIds()).toEqual([]);
    expect(pA.awareness.getStates().has(pB.doc.clientID)).toBe(false);
    expect(hub.pcRegistry.get("peer-a->peer-b")?.closed).toBe(true);

    pA.destroy();
    pB.destroy();
  });

  it("Ca biên: bỏ qua an toàn payload JSON hỏng hoặc thiếu fromPeerId, và destroy() idempotent", async () => {
    const hub = createMockSignalHub();
    const net = hub.attachPeer("peer-a", "user-a");
    const provider = createRoomCollabProvider({
      projectId: "room-safe",
      userId: "user-a",
      peerId: "peer-a",
      webSocketFactory: net.webSocketFactory,
      peerConnectionFactory: net.peerConnectionFactory,
    });

    provider.connect();
    net.openSocket();
    await flushMicrotasks();

    const ws = net.getSocket()!;
    expect(() => {
      ws.receive("{broken-json");
      ws.receive("null");
      ws.receive(JSON.stringify({ type: "offer", roomId: "room-safe" })); // thiếu fromPeerId
      ws.receive(JSON.stringify({ type: "offer", roomId: "other-room", fromPeerId: "p2", fromUserId: "u2" }));
      ws.receive(JSON.stringify({ type: "offer", roomId: "room-safe", fromPeerId: "p2", fromUserId: "u2", payload: "bad" }));
    }).not.toThrow();

    expect(provider.getPeerIds()).toEqual([]);

    expect(() => {
      provider.destroy();
      provider.destroy();
      provider.destroy();
    }).not.toThrow();
  });

  it("resolveSignalUrl async: mở socket với URL đã resolve và hủy an toàn nếu disconnect/destroy giữa chừng", async () => {
    const openedUrls: string[] = [];
    const wsFactory = (url: string): WebSocketLike => {
      openedUrls.push(url);
      return new MockWebSocket(url, () => {}, () => {});
    };

    let resolveFn!: (url: string) => void;
    const provider1 = createRoomCollabProvider({
      projectId: "room-async",
      userId: "user-a",
      peerId: "peer-a",
      resolveSignalUrl: () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        }),
      webSocketFactory: wsFactory,
    });

    provider1.connect();
    expect(openedUrls).toEqual([]);
    resolveFn("wss://sqllens.onrender.com/api/v1/cloud/projects/room-async/signal?ticket=tk_1");
    await flushMicrotasks();
    expect(openedUrls).toEqual([
      "wss://sqllens.onrender.com/api/v1/cloud/projects/room-async/signal?ticket=tk_1",
    ]);
    provider1.destroy();

    // Hủy bằng disconnect() trong lúc đang await resolveSignalUrl() -> không mở socket
    let resolveCanceled!: (url: string) => void;
    const provider2 = createRoomCollabProvider({
      projectId: "room-async-cancel",
      userId: "user-a",
      peerId: "peer-a",
      resolveSignalUrl: () =>
        new Promise<string>((resolve) => {
          resolveCanceled = resolve;
        }),
      webSocketFactory: wsFactory,
    });

    provider2.connect();
    provider2.disconnect();
    resolveCanceled("wss://sqllens.onrender.com/api/v1/cloud/projects/room-async-cancel/signal?ticket=tk_2");
    await flushMicrotasks();
    expect(openedUrls).toHaveLength(1);
    provider2.destroy();
  });

  it("onPeerCountChange và onIceFailed bắn đúng khi peer vào/ra và ICE/connectionState failed", async () => {
    const hub = createMockSignalHub();
    const netA = hub.attachPeer("peer-a", "user-a");
    const netB = hub.attachPeer("peer-b", "user-b");

    const pA = createRoomCollabProvider({
      projectId: "room-events",
      userId: "user-a",
      peerId: "peer-a",
      webSocketFactory: netA.webSocketFactory,
      peerConnectionFactory: netA.peerConnectionFactory,
    });
    const pB = createRoomCollabProvider({
      projectId: "room-events",
      userId: "user-b",
      peerId: "peer-b",
      webSocketFactory: netB.webSocketFactory,
      peerConnectionFactory: netB.peerConnectionFactory,
    });

    const peerCounts: number[] = [];
    const iceFailed = vi.fn();
    const offCount = pA.onPeerCountChange?.((count) => peerCounts.push(count));
    const offIce = pA.onIceFailed?.(iceFailed);

    pA.connect();
    netA.openSocket();
    pB.connect();
    netB.openSocket();
    await flushMicrotasks();

    expect(peerCounts).toEqual([1]);

    const pcA = hub.pcRegistry.get("peer-a->peer-b")!;
    pcA.iceConnectionState = "failed";
    (pcA as unknown as { emit: (t: string, e: PeerConnectionEventLike) => void }).emit(
      "iceconnectionstatechange",
      {},
    );

    expect(iceFailed).toHaveBeenCalledTimes(1);
    expect(peerCounts).toEqual([1, 0]);

    offCount?.();
    offIce?.();
    pA.destroy();
    pB.destroy();
  });
});
