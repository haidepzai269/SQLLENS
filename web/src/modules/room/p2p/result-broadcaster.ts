import { useBatonStore } from "@/modules/room/collab/baton-store";
import {
  BATON_RETURN_TIMEOUT_MS,
  NAT_WARNING_TIMEOUT_MS,
  type BatonReturnedMessage,
  type P2pExecutionResult,
  type ResultBroadcaster,
  type ResultBroadcasterOptions,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidP2pExecutionResult(value: unknown): value is P2pExecutionResult {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.columns) || !value.columns.every((c) => typeof c === "string")) {
    return false;
  }
  if (!Array.isArray(value.rows) || !value.rows.every((r) => Array.isArray(r))) {
    return false;
  }
  if (typeof value.rowCount !== "number" || !Number.isFinite(value.rowCount)) return false;
  if (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs)) return false;
  if (value.error !== undefined && typeof value.error !== "string") return false;
  if (typeof value.tabId !== "string" || value.tabId.length === 0) return false;
  if (typeof value.executedBy !== "string" || value.executedBy.length === 0) return false;
  if (typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt)) return false;
  return true;
}

function defaultUpdateBatonHolder(ownerId: string): void {
  useBatonStore.setState((state) => ({
    holderId: ownerId,
    pendingRequests: state.pendingRequests.filter((uid) => uid !== ownerId),
    status: "ready",
    error: null,
  }));
}

/**
 * Điều phối broadcast kết quả SQL qua WebRTC DataChannel (kênh control),
 * tự động trả Baton về owner khi Driver mất kết nối/ngưng heartbeat quá 30s,
 * và kích hoạt cảnh báo Symmetric NAT nếu sau 10s không có peer nào kết nối.
 */
export function createResultBroadcaster(options: ResultBroadcasterOptions): ResultBroadcaster {
  const {
    sendControl,
    onControl,
    ownerId,
    returnTimeoutMs = BATON_RETURN_TIMEOUT_MS,
    natTimeoutMs = NAT_WARNING_TIMEOUT_MS,
    onUpdateBatonHolder = defaultUpdateBatonHolder,
  } = options;

  if (!ownerId) throw new Error("ownerId is required");

  const resultListeners = new Set<(result: P2pExecutionResult, fromPeerId: string) => void>();
  const batonReturnedListeners = new Set<(message: BatonReturnedMessage) => void>();
  const natWarningListeners = new Set<(warning: boolean) => void>();

  let destroyed = false;
  let hasConnectedPeer = false;
  let natWarning = false;
  let batonReturnedNotified = false;
  let batonReturnTimer: ReturnType<typeof setTimeout> | null = null;
  let natTimer: ReturnType<typeof setTimeout> | null = null;

  const clearBatonReturnTimer = () => {
    if (batonReturnTimer !== null) {
      clearTimeout(batonReturnTimer);
      batonReturnTimer = null;
    }
  };

  const clearNatTimer = () => {
    if (natTimer !== null) {
      clearTimeout(natTimer);
      natTimer = null;
    }
  };

  const setNatWarning = (next: boolean) => {
    if (destroyed || natWarning === next) return;
    natWarning = next;
    for (const cb of natWarningListeners) {
      cb(next);
    }
  };

  const notifyBatonReturned = (msg: BatonReturnedMessage) => {
    if (batonReturnedNotified) return;
    batonReturnedNotified = true;
    for (const cb of batonReturnedListeners) {
      cb(msg);
    }
  };

  const triggerBatonReturn = () => {
    batonReturnTimer = null;
    if (destroyed) return;
    const msg: BatonReturnedMessage = {
      type: "baton-returned",
      holder: ownerId,
    };
    onUpdateBatonHolder(ownerId);
    notifyBatonReturned(msg);
    sendControl(msg as unknown as Record<string, unknown>);
  };

  const scheduleBatonReturn = () => {
    if (destroyed) return;
    batonReturnedNotified = false;
    clearBatonReturnTimer();
    batonReturnTimer = setTimeout(triggerBatonReturn, returnTimeoutMs);
  };

  natTimer = setTimeout(() => {
    natTimer = null;
    if (!destroyed && !hasConnectedPeer) {
      setNatWarning(true);
    }
  }, natTimeoutMs);

  const unsubscribeControl = onControl((message, fromPeerId) => {
    if (destroyed || !isRecord(message)) return;

    if (message.type === "p2p-result") {
      if (!isValidP2pExecutionResult(message.payload)) return;
      for (const cb of resultListeners) {
        cb(message.payload, fromPeerId);
      }
      return;
    }

    if (message.type === "p2p-heartbeat") {
      if (typeof message.fromUserId === "string" && message.fromUserId.length > 0) {
        scheduleBatonReturn();
      }
      return;
    }

    if (message.type === "baton-returned") {
      if (typeof message.holder !== "string" || message.holder.length === 0) return;
      clearBatonReturnTimer();
      onUpdateBatonHolder(message.holder);
      notifyBatonReturned({
        type: "baton-returned",
        holder: message.holder,
      });
    }
  });

  return {
    broadcastResult(result) {
      if (destroyed) return;
      sendControl({
        type: "p2p-result",
        payload: result,
      });
    },

    onResult(cb) {
      resultListeners.add(cb);
      return () => {
        resultListeners.delete(cb);
      };
    },

    recordDriverHeartbeat() {
      scheduleBatonReturn();
    },

    handleDriverDisconnected() {
      scheduleBatonReturn();
    },

    sendHeartbeat(fromUserId) {
      if (destroyed || !fromUserId) return;
      sendControl({
        type: "p2p-heartbeat",
        fromUserId,
        sentAt: Date.now(),
      });
    },

    onBatonReturned(cb) {
      batonReturnedListeners.add(cb);
      return () => {
        batonReturnedListeners.delete(cb);
      };
    },

    reportPeerConnected() {
      if (destroyed) return;
      hasConnectedPeer = true;
      clearNatTimer();
      setNatWarning(false);
    },

    reportIceFailed() {
      if (destroyed) return;
      clearNatTimer();
      setNatWarning(true);
    },

    onNatWarning(cb) {
      natWarningListeners.add(cb);
      return () => {
        natWarningListeners.delete(cb);
      };
    },

    getNatWarning() {
      return natWarning;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearBatonReturnTimer();
      clearNatTimer();
      unsubscribeControl();
      resultListeners.clear();
      batonReturnedListeners.clear();
      natWarningListeners.clear();
    },
  };
}
