export const BATON_RETURN_TIMEOUT_MS = 30_000;
export const NAT_WARNING_TIMEOUT_MS = 10_000;

export interface P2pExecutionResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  error?: string;
  tabId: string;
  executedBy: string;
  sentAt: number;
}

export interface P2pResultControlMessage {
  type: "p2p-result";
  payload: P2pExecutionResult;
}

export interface P2pHeartbeatControlMessage {
  type: "p2p-heartbeat";
  fromUserId: string;
  sentAt: number;
}

export interface BatonReturnedMessage {
  type: "baton-returned";
  holder: string;
}

export interface ResultBroadcasterOptions {
  sendControl: (message: Record<string, unknown>) => void;
  onControl: (cb: (message: unknown, fromPeerId: string) => void) => () => void;
  ownerId: string;
  returnTimeoutMs?: number;
  natTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  onUpdateBatonHolder?: (ownerId: string) => void;
}

export interface ResultBroadcaster {
  broadcastResult: (result: P2pExecutionResult) => void;
  onResult: (cb: (result: P2pExecutionResult, fromPeerId: string) => void) => () => void;
  recordDriverHeartbeat: () => void;
  handleDriverDisconnected: () => void;
  sendHeartbeat: (fromUserId: string) => void;
  onBatonReturned: (cb: (message: BatonReturnedMessage) => void) => () => void;
  reportPeerConnected: () => void;
  reportIceFailed: () => void;
  onNatWarning: (cb: (warning: boolean) => void) => () => void;
  getNatWarning: () => boolean;
  destroy: () => void;
}
