import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

export type SignalMessageType = "join" | "offer" | "answer" | "ice" | "leave";

export interface SignalEnvelope {
  type: SignalMessageType;
  roomId: string;
  fromPeerId: string;
  fromUserId: string;
  toPeerId?: string;
  /** userId đích (theo D3 của Task163, server relay tới mọi tab của userId này nên client phải tự lọc theo toPeerId). */
  to?: string;
  payload?: unknown;
}

export interface BatonControlMessage {
  kind: "baton:request" | "baton:grant" | "baton:return";
  roomId: string;
  fromUserId: string;
  targetUserId?: string;
  sentAt: number;
}

export type RoomRole = "owner" | "editor" | "viewer";

export type BatonStatus = "idle" | "loading" | "ready" | "error";

export interface WebSocketEventLike {
  data?: unknown;
  code?: number;
  reason?: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (
    type: "open" | "message" | "close" | "error",
    listener: (event: WebSocketEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: "open" | "message" | "close" | "error",
    listener: (event: WebSocketEventLike) => void,
  ) => void;
}

export interface DataChannelEventLike {
  data?: unknown;
}

export interface DataChannelLike {
  readonly label: string;
  readonly readyState: "connecting" | "open" | "closing" | "closed";
  binaryType?: "blob" | "arraybuffer";
  send: (data: Uint8Array) => void;
  close: () => void;
  addEventListener: (
    type: "open" | "message" | "close" | "error",
    listener: (event: DataChannelEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: "open" | "message" | "close" | "error",
    listener: (event: DataChannelEventLike) => void,
  ) => void;
}

export interface PeerConnectionEventLike {
  candidate?: RTCIceCandidateInit | null;
  channel?: DataChannelLike;
}

export interface PeerConnectionLike {
  readonly connectionState?: string;
  readonly iceConnectionState?: string;
  readonly signalingState?: string;
  createDataChannel: (label: string, options?: { ordered?: boolean }) => DataChannelLike;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: (desc: RTCSessionDescriptionInit) => Promise<void>;
  setRemoteDescription: (desc: RTCSessionDescriptionInit) => Promise<void>;
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  close: () => void;
  addEventListener: (
    type: "icecandidate" | "datachannel" | "connectionstatechange",
    listener: (event: PeerConnectionEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: "icecandidate" | "datachannel" | "connectionstatechange",
    listener: (event: PeerConnectionEventLike) => void,
  ) => void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type PeerConnectionFactory = (remotePeerId: string) => PeerConnectionLike;

export interface RoomCollabProviderOptions {
  projectId: string;
  userId: string;
  peerId?: string;
  doc?: Y.Doc;
  awareness?: Awareness;
  signalUrl?: string;
  resolveSignalUrl?: () => Promise<string>;
  iceServers?: RTCIceServer[];
  webSocketFactory?: WebSocketFactory;
  peerConnectionFactory?: PeerConnectionFactory;
}

export interface RoomCollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly peerId: string;
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
  sendControl: (message: BatonControlMessage | Record<string, unknown>) => void;
  onControl: (cb: (message: unknown, fromPeerId: string) => void) => () => void;
  onPeerCountChange?: (cb: (count: number) => void) => () => void;
  onIceFailed?: (cb: () => void) => () => void;
  getPeerIds: () => string[];
}
