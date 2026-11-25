import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type {
  BatonControlMessage,
  DataChannelEventLike,
  DataChannelLike,
  PeerConnectionEventLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  RoomCollabProvider,
  RoomCollabProviderOptions,
  SignalEnvelope,
  SignalMessageType,
  WebSocketEventLike,
  WebSocketLike,
} from "./types";

const COLLAB_CHANNEL_LABEL = "sqllens-collab";
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CONTROL = 2;

const WS_OPEN = 1;
const CLEANUP_ORIGIN = Symbol("room-collab-cleanup");
const VALID_SIGNAL_TYPES = new Set<SignalMessageType>(["join", "offer", "answer", "ice", "leave"]);

interface PeerEntry {
  remotePeerId: string;
  remoteUserId: string;
  pc: PeerConnectionLike;
  dc: DataChannelLike | null;
  makingOffer: boolean;
  remoteDescriptionSet: boolean;
  iceFailedNotified: boolean;
  pendingIceCandidates: RTCIceCandidateInit[];
  awarenessClientIds: Set<number>;
  onIceCandidate: (event: PeerConnectionEventLike) => void;
  onDataChannel: (event: PeerConnectionEventLike) => void;
  onConnectionStateChange: () => void;
  onIceConnectionStateChange: () => void;
  dcCleanup?: () => void;
}

function resolveSignalUrl(projectId: string, customUrl?: string): string {
  if (customUrl) return customUrl;
  const path = `/api/v1/cloud/projects/${encodeURIComponent(projectId)}/signal`;
  if (typeof window !== "undefined" && window.location && window.location.host) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${path}`;
  }
  return path;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url);
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function wrapDataChannel(dc: RTCDataChannel): DataChannelLike {
  dc.binaryType = "arraybuffer";
  return {
    get label() {
      return dc.label;
    },
    get readyState() {
      return dc.readyState;
    },
    get binaryType() {
      return dc.binaryType;
    },
    set binaryType(value: "blob" | "arraybuffer") {
      dc.binaryType = value;
    },
    send(data: Uint8Array) {
      dc.send(toArrayBuffer(data));
    },
    close() {
      dc.close();
    },
    addEventListener(type, listener) {
      dc.addEventListener(type, listener as EventListener);
    },
    removeEventListener(type, listener) {
      dc.removeEventListener(type, listener as EventListener);
    },
  };
}

function createDefaultPeerConnectionFactory(iceServers?: RTCIceServer[]): PeerConnectionFactory {
  return () => {
    const pc = new RTCPeerConnection(iceServers ? { iceServers } : undefined);
    const wrappedDcMap = new WeakMap<RTCDataChannel, DataChannelLike>();
    const getWrappedDc = (raw: RTCDataChannel): DataChannelLike => {
      const existing = wrappedDcMap.get(raw);
      if (existing) return existing;
      const wrapped = wrapDataChannel(raw);
      wrappedDcMap.set(raw, wrapped);
      return wrapped;
    };

    const listenerMap = new WeakMap<
      (event: PeerConnectionEventLike) => void,
      EventListener
    >();

    return {
      get connectionState() {
        return pc.connectionState;
      },
      get iceConnectionState() {
        return pc.iceConnectionState;
      },
      get signalingState() {
        return pc.signalingState;
      },
      createDataChannel(label, options) {
        return getWrappedDc(pc.createDataChannel(label, options));
      },
      createOffer() {
        return pc.createOffer();
      },
      createAnswer() {
        return pc.createAnswer();
      },
      setLocalDescription(desc) {
        return pc.setLocalDescription(desc);
      },
      setRemoteDescription(desc) {
        return pc.setRemoteDescription(desc);
      },
      addIceCandidate(candidate) {
        return pc.addIceCandidate(candidate);
      },
      close() {
        pc.close();
      },
      addEventListener(type, listener) {
        const handler: EventListener = (rawEvent) => {
          if (type === "icecandidate") {
            const ev = rawEvent as RTCPeerConnectionIceEvent;
            listener({ candidate: ev.candidate ? ev.candidate.toJSON() : null });
            return;
          }
          if (type === "datachannel") {
            const ev = rawEvent as RTCDataChannelEvent;
            listener({ channel: getWrappedDc(ev.channel) });
            return;
          }
          listener({});
        };
        listenerMap.set(listener, handler);
        pc.addEventListener(type, handler);
      },
      removeEventListener(type, listener) {
        const handler = listenerMap.get(listener);
        if (handler) {
          pc.removeEventListener(type, handler);
          listenerMap.delete(listener);
        }
      },
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionDescription(value: unknown): value is RTCSessionDescriptionInit {
  if (!isRecord(value)) return false;
  return typeof value.type === "string" && (value.sdp === undefined || typeof value.sdp === "string");
}

function isIceCandidate(value: unknown): value is RTCIceCandidateInit {
  if (!isRecord(value)) return false;
  return typeof value.candidate === "string";
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/**
 * Tạo bộ đồng bộ Yjs + Awareness + kênh điều khiển Baton qua WebRTC DataChannel,
 * dùng WebSocket `/signal` làm JSON relay thuần (0 byte SQL).
 */
export function createRoomCollabProvider(options: RoomCollabProviderOptions): RoomCollabProvider {
  const { projectId, userId } = options;
  if (!projectId) throw new Error("projectId is required");
  if (!userId) throw new Error("userId is required");

  const peerId = options.peerId || crypto.randomUUID();
  const doc = options.doc ?? new Y.Doc();
  const ownsAwareness = !options.awareness;
  const awareness = options.awareness ?? new awarenessProtocol.Awareness(doc);
  const wsFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  const pcFactory = options.peerConnectionFactory ?? createDefaultPeerConnectionFactory(options.iceServers);
  const signalUrl = resolveSignalUrl(projectId, options.signalUrl);

  const peers = new Map<string, PeerEntry>();
  const controlListeners = new Set<(message: unknown, fromPeerId: string) => void>();
  const peerCountListeners = new Set<(count: number) => void>();
  const iceFailedListeners = new Set<() => void>();

  let ws: WebSocketLike | null = null;
  let wsCleanup: (() => void) | null = null;
  let destroyed = false;
  let connecting = false;
  let connectSeq = 0;

  const notifyPeerCount = () => {
    const count = peers.size;
    for (const cb of peerCountListeners) {
      cb(count);
    }
  };

  const notifyIceFailed = (entry: PeerEntry) => {
    if (entry.iceFailedNotified) return;
    entry.iceFailedNotified = true;
    for (const cb of iceFailedListeners) {
      cb();
    }
  };

  const sendSignal = (envelope: SignalEnvelope) => {
    if (destroyed || !ws || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(envelope));
    } catch {
      // Bỏ qua lỗi ghi lên socket đang đóng.
    }
  };

  const sendDataChannelBytes = (dc: DataChannelLike | null, bytes: Uint8Array) => {
    if (!dc || dc.readyState !== "open") return;
    try {
      dc.send(bytes);
    } catch {
      // Bỏ qua khi DataChannel vừa đóng giữa lúc gửi.
    }
  };

  const broadcastBytes = (bytes: Uint8Array, excludeOrigin?: unknown) => {
    for (const entry of peers.values()) {
      if (entry === excludeOrigin) continue;
      sendDataChannelBytes(entry.dc, bytes);
    }
  };

  const sendInitialSync = (dc: DataChannelLike) => {
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    sendDataChannelBytes(dc, encoding.toUint8Array(syncEncoder));

    if (awareness.getLocalState() !== null) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
      );
      sendDataChannelBytes(dc, encoding.toUint8Array(awarenessEncoder));
    }
  };

  const handleDataChannelMessage = (entry: PeerEntry, rawData: unknown) => {
    if (destroyed) return;
    if (typeof rawData === "string") {
      try {
        const parsed: unknown = JSON.parse(rawData);
        for (const listener of controlListeners) {
          listener(parsed, entry.remotePeerId);
        }
      } catch {
        // Bỏ qua chuỗi JSON không hợp lệ.
      }
      return;
    }

    const bytes = toUint8Array(rawData);
    if (!bytes || bytes.byteLength === 0) return;

    try {
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, entry);
        if (encoding.length(encoder) > 1) {
          sendDataChannelBytes(entry.dc, encoding.toUint8Array(encoder));
        }
        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, entry);
        return;
      }

      if (messageType === MESSAGE_CONTROL) {
        const jsonText = decoding.readVarString(decoder);
        const parsed: unknown = JSON.parse(jsonText);
        for (const listener of controlListeners) {
          listener(parsed, entry.remotePeerId);
        }
      }
    } catch {
      // Bỏ qua khung dữ liệu hỏng trên DataChannel.
    }
  };

  const cleanupPeer = (remotePeerId: string) => {
    const entry = peers.get(remotePeerId);
    if (!entry) return;
    peers.delete(remotePeerId);

    entry.dcCleanup?.();
    entry.dcCleanup = undefined;

    if (entry.dc) {
      try {
        entry.dc.close();
      } catch {
        // Ignore close error on already-closed channel.
      }
      entry.dc = null;
    }

    entry.pc.removeEventListener?.("icecandidate", entry.onIceCandidate);
    entry.pc.removeEventListener?.("datachannel", entry.onDataChannel);
    entry.pc.removeEventListener?.("connectionstatechange", entry.onConnectionStateChange);
    (
      entry.pc.removeEventListener as
        | ((type: string, listener: (event: PeerConnectionEventLike) => void) => void)
        | undefined
    )?.("iceconnectionstatechange", entry.onIceConnectionStateChange);

    try {
      entry.pc.close();
    } catch {
      // Ignore close error on already-closed peer connection.
    }

    if (entry.awarenessClientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        awareness,
        Array.from(entry.awarenessClientIds),
        CLEANUP_ORIGIN,
      );
      entry.awarenessClientIds.clear();
    }

    notifyPeerCount();
  };

  const attachDataChannel = (entry: PeerEntry, dc: DataChannelLike) => {
    if (entry.dc === dc) return;
    entry.dcCleanup?.();
    if (entry.dc) {
      try {
        entry.dc.close();
      } catch {
        // Ignore stale channel close error.
      }
    }

    entry.dc = dc;
    dc.binaryType = "arraybuffer";

    const onOpen = () => {
      if (destroyed || peers.get(entry.remotePeerId) !== entry || entry.dc !== dc) return;
      sendInitialSync(dc);
    };
    const onMessage = (event: DataChannelEventLike) => {
      if (peers.get(entry.remotePeerId) !== entry || entry.dc !== dc) return;
      handleDataChannelMessage(entry, event.data);
    };
    const onClose = () => {
      if (peers.get(entry.remotePeerId) === entry && entry.dc === dc) {
        cleanupPeer(entry.remotePeerId);
      }
    };

    dc.addEventListener("open", onOpen);
    dc.addEventListener("message", onMessage);
    dc.addEventListener("close", onClose);
    entry.dcCleanup = () => {
      dc.removeEventListener?.("open", onOpen);
      dc.removeEventListener?.("message", onMessage);
      dc.removeEventListener?.("close", onClose);
    };

    if (dc.readyState === "open") {
      sendInitialSync(dc);
    }
  };

  const getOrCreatePeer = (remotePeerId: string, remoteUserId: string): PeerEntry => {
    const existing = peers.get(remotePeerId);
    if (existing) {
      if (remoteUserId && !existing.remoteUserId) {
        existing.remoteUserId = remoteUserId;
      }
      return existing;
    }

    const pc = pcFactory(remotePeerId);
    const entry: PeerEntry = {
      remotePeerId,
      remoteUserId,
      pc,
      dc: null,
      makingOffer: false,
      remoteDescriptionSet: false,
      iceFailedNotified: false,
      pendingIceCandidates: [],
      awarenessClientIds: new Set<number>(),
      onIceCandidate: (event) => {
        if (destroyed || peers.get(remotePeerId) !== entry || !event.candidate) return;
        sendSignal({
          type: "ice",
          roomId: projectId,
          fromPeerId: peerId,
          fromUserId: userId,
          toPeerId: remotePeerId,
          to: entry.remoteUserId || undefined,
          payload: event.candidate,
        });
      },
      onDataChannel: (event) => {
        if (destroyed || peers.get(remotePeerId) !== entry || !event.channel) return;
        if (event.channel.label === COLLAB_CHANNEL_LABEL || !entry.dc) {
          attachDataChannel(entry, event.channel);
        }
      },
      onConnectionStateChange: () => {
        if (peers.get(remotePeerId) !== entry) return;
        const state = pc.connectionState;
        if (state === "failed") {
          notifyIceFailed(entry);
          cleanupPeer(remotePeerId);
        } else if (state === "closed") {
          cleanupPeer(remotePeerId);
        }
      },
      onIceConnectionStateChange: () => {
        if (peers.get(remotePeerId) !== entry) return;
        if (pc.iceConnectionState === "failed") {
          notifyIceFailed(entry);
          cleanupPeer(remotePeerId);
        }
      },
    };

    pc.addEventListener("icecandidate", entry.onIceCandidate);
    pc.addEventListener("datachannel", entry.onDataChannel);
    pc.addEventListener("connectionstatechange", entry.onConnectionStateChange);
    (
      pc.addEventListener as (
        type: string,
        listener: (event: PeerConnectionEventLike) => void,
      ) => void
    )("iceconnectionstatechange", entry.onIceConnectionStateChange);
    peers.set(remotePeerId, entry);
    notifyPeerCount();
    return entry;
  };

  const flushPendingIce = async (entry: PeerEntry) => {
    if (!entry.remoteDescriptionSet || entry.pendingIceCandidates.length === 0) return;
    const queued = entry.pendingIceCandidates.splice(0, entry.pendingIceCandidates.length);
    for (const candidate of queued) {
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // Bỏ qua ICE candidate không hợp lệ.
      }
    }
  };

  const initiateOffer = async (entry: PeerEntry) => {
    if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
    try {
      entry.makingOffer = true;
      if (!entry.dc) {
        const dc = entry.pc.createDataChannel(COLLAB_CHANNEL_LABEL, { ordered: true });
        attachDataChannel(entry, dc);
      }
      const offer = await entry.pc.createOffer();
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      await entry.pc.setLocalDescription(offer);
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      sendSignal({
        type: "offer",
        roomId: projectId,
        fromPeerId: peerId,
        fromUserId: userId,
        toPeerId: entry.remotePeerId,
        to: entry.remoteUserId || undefined,
        payload: offer,
      });
    } catch {
      // Nếu đàm phán offer lỗi, dọn peer tránh kẹt trạng thái nửa vời.
      if (peers.get(entry.remotePeerId) === entry) {
        cleanupPeer(entry.remotePeerId);
      }
    } finally {
      entry.makingOffer = false;
    }
  };

  const parseSignalEnvelope = (raw: unknown): SignalEnvelope | null => {
    if (typeof raw !== "string" || raw.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;

    const { type, roomId, fromPeerId, fromUserId, toPeerId, to, payload } = parsed;
    if (typeof type !== "string" || !VALID_SIGNAL_TYPES.has(type as SignalMessageType)) return null;
    if (roomId !== projectId) return null;
    if (typeof fromPeerId !== "string" || fromPeerId.length === 0) return null;
    if (typeof fromUserId !== "string") return null;
    if (fromPeerId === peerId) return null;

    // Khóa D3: server relay dựa theo userId (`to`), nên khi cùng userId mở nhiều tab,
    // mỗi tab bắt buộc tự lọc theo `toPeerId`.
    if (typeof toPeerId === "string" && toPeerId.length > 0 && toPeerId !== peerId) {
      return null;
    }

    return {
      type: type as SignalMessageType,
      roomId,
      fromPeerId,
      fromUserId,
      toPeerId: typeof toPeerId === "string" ? toPeerId : undefined,
      to: typeof to === "string" ? to : undefined,
      payload,
    };
  };

  const handleOffer = async (env: SignalEnvelope) => {
    if (!isSessionDescription(env.payload) || env.payload.type !== "offer") return;
    const entry = getOrCreatePeer(env.fromPeerId, env.fromUserId);

    const offerCollision =
      entry.makingOffer || (entry.pc.signalingState !== undefined && entry.pc.signalingState !== "stable");
    // Xử lý glare tất định: peerId nhỏ hơn thắng (impolite), peerId lớn hơn nhường (polite).
    const polite = peerId > env.fromPeerId;
    if (offerCollision && !polite) {
      return;
    }

    if (offerCollision && polite && entry.dc && entry.dc.readyState !== "open") {
      // Kênh tạm tạo khi đang làm offer nay nhường cho kênh của impolite peer.
      entry.dcCleanup?.();
      entry.dcCleanup = undefined;
      try {
        entry.dc.close();
      } catch {
        // Ignore close error.
      }
      entry.dc = null;
    }

    try {
      await entry.pc.setRemoteDescription(env.payload);
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      entry.remoteDescriptionSet = true;
      entry.makingOffer = false;
      await flushPendingIce(entry);
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;

      const answer = await entry.pc.createAnswer();
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      await entry.pc.setLocalDescription(answer);
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;

      sendSignal({
        type: "answer",
        roomId: projectId,
        fromPeerId: peerId,
        fromUserId: userId,
        toPeerId: env.fromPeerId,
        to: env.fromUserId || undefined,
        payload: answer,
      });
    } catch {
      if (peers.get(entry.remotePeerId) === entry) {
        cleanupPeer(entry.remotePeerId);
      }
    }
  };

  const handleAnswer = async (env: SignalEnvelope) => {
    if (!isSessionDescription(env.payload) || env.payload.type !== "answer") return;
    const entry = peers.get(env.fromPeerId);
    if (!entry) return;
    try {
      await entry.pc.setRemoteDescription(env.payload);
      if (destroyed || peers.get(entry.remotePeerId) !== entry) return;
      entry.remoteDescriptionSet = true;
      await flushPendingIce(entry);
    } catch {
      if (peers.get(entry.remotePeerId) === entry) {
        cleanupPeer(entry.remotePeerId);
      }
    }
  };

  const handleIce = async (env: SignalEnvelope) => {
    if (!isIceCandidate(env.payload)) return;
    const entry = getOrCreatePeer(env.fromPeerId, env.fromUserId);
    if (!entry.remoteDescriptionSet) {
      entry.pendingIceCandidates.push(env.payload);
      return;
    }
    try {
      await entry.pc.addIceCandidate(env.payload);
    } catch {
      // Bỏ qua ICE candidate lỗi.
    }
  };

  const handleSignalMessage = (rawData: unknown) => {
    if (destroyed) return;
    const env = parseSignalEnvelope(rawData);
    if (!env) return;

    switch (env.type) {
      case "join": {
        const hadPeer = peers.has(env.fromPeerId);
        const entry = getOrCreatePeer(env.fromPeerId, env.fromUserId);
        if (peerId < env.fromPeerId) {
          if (!hadPeer) {
            void initiateOffer(entry);
          }
        } else if (!env.toPeerId) {
          // Server relay không lưu lịch sử join, nên peer lớn hơn báo lại danh tính để peer mới chủ động offer.
          sendSignal({
            type: "join",
            roomId: projectId,
            fromPeerId: peerId,
            fromUserId: userId,
            toPeerId: env.fromPeerId,
            to: env.fromUserId || undefined,
          });
        }
        break;
      }
      case "offer":
        void handleOffer(env);
        break;
      case "answer":
        void handleAnswer(env);
        break;
      case "ice":
        void handleIce(env);
        break;
      case "leave":
        cleanupPeer(env.fromPeerId);
        break;
    }
  };

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (destroyed) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    broadcastBytes(encoding.toUint8Array(encoder), origin);
  };

  const onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (destroyed) return;

    if (origin && typeof origin === "object" && "remotePeerId" in origin) {
      const entry = origin as PeerEntry;
      if (peers.get(entry.remotePeerId) === entry) {
        for (const id of changes.added) entry.awarenessClientIds.add(id);
        for (const id of changes.updated) entry.awarenessClientIds.add(id);
        for (const id of changes.removed) entry.awarenessClientIds.delete(id);
      }
      return;
    }

    if (origin === CLEANUP_ORIGIN) return;

    const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
    if (changedClients.length === 0) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    );
    broadcastBytes(encoding.toUint8Array(encoder));
  };

  doc.on("update", onDocUpdate);
  awareness.on("update", onAwarenessUpdate);

  const openSocket = (targetUrl: string) => {
    if (destroyed || ws) return;
    const socket = wsFactory(targetUrl);
    ws = socket;

    const onOpen = () => {
      if (destroyed || ws !== socket) return;
      sendSignal({
        type: "join",
        roomId: projectId,
        fromPeerId: peerId,
        fromUserId: userId,
      });
    };

    const onMessage = (event: WebSocketEventLike) => {
      if (destroyed || ws !== socket) return;
      handleSignalMessage(event.data);
    };

    const onClose = () => {
      if (ws === socket) {
        wsCleanup?.();
        wsCleanup = null;
        ws = null;
      }
    };

    const onError = () => {
      // Không ném lỗi thô ra ngoài; trạng thái đóng sẽ do onClose xử lý.
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);

    wsCleanup = () => {
      socket.removeEventListener?.("open", onOpen);
      socket.removeEventListener?.("message", onMessage);
      socket.removeEventListener?.("close", onClose);
      socket.removeEventListener?.("error", onError);
    };

    if (socket.readyState === WS_OPEN) {
      onOpen();
    }
  };

  const connect = () => {
    if (destroyed || ws || connecting) return;
    if (!options.resolveSignalUrl) {
      openSocket(signalUrl);
      return;
    }

    connecting = true;
    const mySeq = ++connectSeq;
    void (async () => {
      try {
        const resolvedUrl = await options.resolveSignalUrl!();
        if (destroyed || ws || connectSeq !== mySeq) return;
        openSocket(resolvedUrl);
      } catch {
        // Không mở socket khi resolve URL/ticket thất bại; caller có thể thử lại connect().
      } finally {
        if (connectSeq === mySeq) {
          connecting = false;
        }
      }
    })();
  };

  const disconnect = () => {
    connectSeq++;
    connecting = false;
    if (ws) {
      if (ws.readyState === WS_OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: "leave",
              roomId: projectId,
              fromPeerId: peerId,
              fromUserId: userId,
            } satisfies SignalEnvelope),
          );
        } catch {
          // Ignore send failure when closing.
        }
      }
      wsCleanup?.();
      wsCleanup = null;
      const closingSocket = ws;
      ws = null;
      try {
        closingSocket.close(1000, "disconnect");
      } catch {
        // Ignore close error.
      }
    }

    for (const remotePeerId of Array.from(peers.keys())) {
      cleanupPeer(remotePeerId);
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    disconnect();
    doc.off("update", onDocUpdate);
    awareness.off("update", onAwarenessUpdate);
    controlListeners.clear();
    peerCountListeners.clear();
    iceFailedListeners.clear();
    if (ownsAwareness) {
      (awareness as awarenessProtocol.Awareness & { destroy?: () => void }).destroy?.();
    }
  };

  const sendControl = (message: BatonControlMessage | Record<string, unknown>) => {
    if (destroyed) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CONTROL);
    encoding.writeVarString(encoder, JSON.stringify(message));
    broadcastBytes(encoding.toUint8Array(encoder));
  };

  const onControl = (cb: (message: unknown, fromPeerId: string) => void) => {
    controlListeners.add(cb);
    return () => {
      controlListeners.delete(cb);
    };
  };

  const onPeerCountChange = (cb: (count: number) => void) => {
    peerCountListeners.add(cb);
    return () => {
      peerCountListeners.delete(cb);
    };
  };

  const onIceFailed = (cb: () => void) => {
    iceFailedListeners.add(cb);
    return () => {
      iceFailedListeners.delete(cb);
    };
  };

  const getPeerIds = () => Array.from(peers.keys());

  return {
    doc,
    awareness,
    peerId,
    connect,
    disconnect,
    destroy,
    sendControl,
    onControl,
    onPeerCountChange,
    onIceFailed,
    getPeerIds,
  };
}
