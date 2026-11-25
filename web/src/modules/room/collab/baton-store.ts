import { create, type StoreApi, type UseBoundStore } from "zustand";
import { isApiError } from "@/contracts/api-error";
import type { BatonControlMessage, BatonStatus, RoomRole } from "./types";

export interface BatonSnapshot {
  holderId: string | null;
  step?: number;
  updatedAt?: string | null;
}

export interface BatonTransport {
  sendControl: (message: BatonControlMessage) => void | Promise<void>;
}

export interface BatonAdapter {
  fetchBaton?: (projectId: string) => Promise<BatonSnapshot>;
  claimBaton?: (projectId: string) => Promise<BatonSnapshot>;
  transport?: BatonTransport;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface SetBatonRoomInput {
  projectId: string | null;
  myUserId: string | null;
  myRole: RoomRole | null;
  holderId?: string | null;
}

export interface BatonStoreState {
  projectId: string | null;
  holderId: string | null;
  myUserId: string | null;
  myRole: RoomRole | null;
  memberNames: Record<string, string>;
  pendingRequests: string[];
  status: BatonStatus;
  error: string | null;

  setRoom: (room: SetBatonRoomInput) => void;
  setMemberNames: (names: Record<string, string>) => void;
  setTransport: (transport: BatonTransport | null) => void;
  syncFromServer: () => Promise<void>;
  claimBaton: () => Promise<boolean>;
  requestBaton: () => Promise<boolean>;
  grantBaton: (targetUserId: string) => Promise<boolean>;
  returnBaton: () => Promise<boolean>;
  applyControlMessage: (msg: BatonControlMessage) => void;
  reset: () => void;
}

export class BatonApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Baton request failed (${status}: ${code})`);
    this.name = "BatonApiError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, BatonApiError.prototype);
  }
}

const CLOUD_BASE = "/api/v1/cloud/projects";

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function parseBatonSnapshot(body: unknown): BatonSnapshot {
  if (typeof body !== "object" || body === null) {
    throw new BatonApiError(0, "invalid_response");
  }
  const obj = body as Record<string, unknown>;
  if (obj.holderId !== null && typeof obj.holderId !== "string") {
    throw new BatonApiError(0, "invalid_response");
  }
  return {
    holderId: obj.holderId,
    step: typeof obj.step === "number" ? obj.step : undefined,
    updatedAt:
      obj.updatedAt === null || typeof obj.updatedAt === "string"
        ? obj.updatedAt
        : undefined,
  };
}

function createRestFetcher(fetchImpl: typeof fetch) {
  const send = async (method: "GET" | "POST", url: string): Promise<BatonSnapshot> => {
    const res = await fetchImpl(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJsonSafe(res);
    if (!res.ok) {
      const code = isApiError(body) ? body.error.code : "unknown";
      throw new BatonApiError(res.status, code);
    }
    return parseBatonSnapshot(body);
  };

  return {
    fetchBaton: (projectId: string) =>
      send("GET", `${CLOUD_BASE}/${encodeURIComponent(projectId)}/baton`),
    claimBaton: (projectId: string) =>
      send("POST", `${CLOUD_BASE}/${encodeURIComponent(projectId)}/baton/claim`),
  };
}

const INITIAL_STATE = {
  projectId: null as string | null,
  holderId: null as string | null,
  myUserId: null as string | null,
  myRole: null as RoomRole | null,
  memberNames: {} as Record<string, string>,
  pendingRequests: [] as string[],
  status: "idle" as BatonStatus,
  error: null as string | null,
};

/**
 * Tạo Zustand store điều phối quyền viết (The Baton) cho một phiên cộng tác.
 * Dùng 2 REST endpoint thật (`GET /baton`, `POST /baton/claim`) và chuyển tiếp
 * request/grant/return qua `BatonTransport` (mặc định kênh control P2P DataChannel).
 */
export function createBatonStore(
  adapter: BatonAdapter = {},
): UseBoundStore<StoreApi<BatonStoreState>> {
  const rest = createRestFetcher(adapter.fetchImpl ?? fetch);
  const fetchBaton = adapter.fetchBaton ?? rest.fetchBaton;
  const claimBatonApi = adapter.claimBaton ?? rest.claimBaton;
  const now = adapter.now ?? (() => Date.now());
  let currentTransport: BatonTransport | null = adapter.transport ?? null;

  return create<BatonStoreState>()((set, get) => ({
    ...INITIAL_STATE,

    setRoom: ({ projectId, myUserId, myRole, holderId }) => {
      set((state) => ({
        projectId,
        myUserId,
        myRole,
        holderId: holderId !== undefined ? holderId : state.projectId === projectId ? state.holderId : null,
        memberNames: state.projectId === projectId ? state.memberNames : {},
        pendingRequests: state.projectId === projectId ? state.pendingRequests : [],
        status: projectId ? state.status : "idle",
        error: null,
      }));
    },

    setMemberNames: (names) => {
      set({ memberNames: { ...names } });
    },

    setTransport: (transport) => {
      currentTransport = transport;
    },

    syncFromServer: async () => {
      const { projectId } = get();
      if (!projectId) {
        set({ status: "error", error: "project_required" });
        return;
      }

      set({ status: "loading", error: null });
      try {
        const snapshot = await fetchBaton(projectId);
        if (get().projectId !== projectId) return;
        set({
          holderId: snapshot.holderId,
          status: "ready",
          error: null,
        });
      } catch (err) {
        if (get().projectId !== projectId) return;
        set({
          status: "error",
          error: err instanceof Error ? err.message : "baton_sync_failed",
        });
      }
    },

    claimBaton: async () => {
      const { projectId, myUserId, myRole } = get();
      if (!projectId || !myUserId || myRole === "viewer" || myRole === null) {
        return false;
      }

      set({ status: "loading", error: null });
      try {
        const snapshot = await claimBatonApi(projectId);
        if (get().projectId !== projectId) return false;
        set((state) => ({
          holderId: snapshot.holderId,
          pendingRequests: snapshot.holderId
            ? state.pendingRequests.filter((uid) => uid !== snapshot.holderId)
            : state.pendingRequests,
          status: "ready",
          error: null,
        }));
        return true;
      } catch (err) {
        if (get().projectId !== projectId) return false;
        set({
          status: "error",
          error: err instanceof Error ? err.message : "baton_claim_failed",
        });
        return false;
      }
    },

    requestBaton: async () => {
      const { projectId, myUserId, myRole } = get();
      if (!projectId || !myUserId || myRole === "viewer" || myRole === null) {
        return false;
      }

      const msg: BatonControlMessage = {
        kind: "baton:request",
        roomId: projectId,
        fromUserId: myUserId,
        sentAt: now(),
      };
      try {
        await currentTransport?.sendControl(msg);
      } catch (err) {
        set({
          status: "error",
          error: err instanceof Error ? err.message : "baton_request_failed",
        });
        return false;
      }

      set((state) => ({
        pendingRequests: state.pendingRequests.includes(myUserId)
          ? state.pendingRequests
          : [...state.pendingRequests, myUserId],
        error: null,
      }));
      return true;
    },

    grantBaton: async (targetUserId) => {
      const { projectId, myUserId, myRole, holderId } = get();
      const target = targetUserId.trim();
      if (!projectId || !myUserId || !target || myRole === "viewer" || myRole === null) {
        return false;
      }
      if (myRole !== "owner" && holderId !== myUserId) {
        return false;
      }

      const msg: BatonControlMessage = {
        kind: "baton:grant",
        roomId: projectId,
        fromUserId: myUserId,
        targetUserId: target,
        sentAt: now(),
      };
      try {
        await currentTransport?.sendControl(msg);
      } catch (err) {
        set({
          status: "error",
          error: err instanceof Error ? err.message : "baton_grant_failed",
        });
        return false;
      }

      set((state) => ({
        holderId: target,
        pendingRequests: state.pendingRequests.filter((uid) => uid !== target),
        status: "ready",
        error: null,
      }));
      return true;
    },

    returnBaton: async () => {
      const { projectId, myUserId, myRole, holderId } = get();
      if (!projectId || !myUserId || myRole === "viewer" || myRole === null) {
        return false;
      }
      if (myRole !== "owner" && holderId !== myUserId) {
        return false;
      }

      const msg: BatonControlMessage = {
        kind: "baton:return",
        roomId: projectId,
        fromUserId: myUserId,
        sentAt: now(),
      };
      try {
        await currentTransport?.sendControl(msg);
      } catch (err) {
        set({
          status: "error",
          error: err instanceof Error ? err.message : "baton_return_failed",
        });
        return false;
      }

      set({
        holderId: null,
        status: "ready",
        error: null,
      });
      return true;
    },

    applyControlMessage: (msg) => {
      const { projectId } = get();
      if (!msg || typeof msg !== "object") return;
      if (!projectId || msg.roomId !== projectId) return;
      if (typeof msg.fromUserId !== "string" || msg.fromUserId.length === 0) return;

      switch (msg.kind) {
        case "baton:request":
          set((state) =>
            state.pendingRequests.includes(msg.fromUserId)
              ? state
              : { pendingRequests: [...state.pendingRequests, msg.fromUserId] },
          );
          break;
        case "baton:grant":
          if (typeof msg.targetUserId === "string" && msg.targetUserId.length > 0) {
            const nextHolder = msg.targetUserId;
            set((state) => ({
              holderId: nextHolder,
              pendingRequests: state.pendingRequests.filter((uid) => uid !== nextHolder),
              status: "ready",
            }));
          }
          break;
        case "baton:return":
          set((state) =>
            state.holderId === msg.fromUserId
              ? { holderId: null, status: "ready" }
              : state,
          );
          break;
      }
    },

    reset: () => {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useBatonStore = createBatonStore();
