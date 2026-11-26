"use client";

import type { Extension } from "@codemirror/state";
import { useEffect, useMemo, useRef, useState } from "react";
import { createResultBroadcaster } from "../p2p/result-broadcaster";
import type { P2pExecutionResult, ResultBroadcaster } from "../p2p/types";
import { useBatonStore } from "./baton-store";
import { createTabCollabExtension } from "./collab-binding";
import { createRoomCollabProvider } from "./room-provider";
import { buildDirectSignalUrl, requestSignalTicket } from "./signal-ticket";
import type { BatonControlMessage, RoomCollabProvider, RoomRole } from "./types";

export interface UseLabRoomCollabDeps {
  fetchImpl?: typeof fetch;
  createProvider?: typeof createRoomCollabProvider;
  createBroadcaster?: typeof createResultBroadcaster;
  createTabExtension?: typeof createTabCollabExtension;
  resolveSignalUrl?: (projectId: string) => Promise<string | undefined> | string | undefined;
}

export interface UseLabRoomCollabOptions {
  remoteProjectId: string | null;
  activeTabId: string | null;
  activeTabPosition?: number | null;
  initialTabSql?: string;
  userId: string | null;
  onRemoteResult?: (res: P2pExecutionResult) => void;
  deps?: UseLabRoomCollabDeps;
}

export interface UseLabRoomCollabResult {
  collabExtension: Extension | null;
  broadcastResult: ((res: P2pExecutionResult) => void) | null;
}

interface RoomSession {
  remoteProjectId: string;
  userId: string;
  provider: RoomCollabProvider;
  broadcaster: ResultBroadcaster;
  myRole: RoomRole;
}

const VALID_ROLES = new Set<RoomRole>(["owner", "editor", "viewer"]);
const BATON_KINDS = new Set<BatonControlMessage["kind"]>([
  "baton:request",
  "baton:grant",
  "baton:return",
]);

function isRoomRole(value: unknown): value is RoomRole {
  return typeof value === "string" && VALID_ROLES.has(value as RoomRole);
}

function isBatonControlMessage(value: unknown): value is BatonControlMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    typeof msg.kind === "string" &&
    BATON_KINDS.has(msg.kind as BatonControlMessage["kind"]) &&
    typeof msg.roomId === "string" &&
    typeof msg.fromUserId === "string"
  );
}

interface RoomBootstrapInfo {
  myRole: RoomRole;
  ownerId: string;
  ownerName: string;
  holderId: string | null;
  memberNames: Record<string, string>;
}

async function fetchBatonBootstrap(
  remoteProjectId: string,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<{ myRole: RoomRole; ownerId: string; ownerName: string; holderId: string | null }> {
  const fallback = {
    myRole: "viewer" as RoomRole,
    ownerId: userId,
    ownerName: "",
    holderId: null as string | null,
  };
  try {
    const res = await fetchImpl(
      `/api/v1/cloud/projects/${encodeURIComponent(remoteProjectId)}/baton`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    if (!res.ok) return fallback;
    const payload = (await res.json()) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") return fallback;

    const myRole = isRoomRole(payload.myRole) ? payload.myRole : "viewer";
    const ownerId = typeof payload.ownerId === "string" && payload.ownerId ? payload.ownerId : userId;
    const ownerName = typeof payload.ownerName === "string" ? payload.ownerName : "";
    const holderId = typeof payload.holderId === "string" ? payload.holderId : null;
    return { myRole, ownerId, ownerName, holderId };
  } catch {
    return fallback;
  }
}

async function fetchOwnerMemberNames(
  remoteProjectId: string,
  ownerId: string,
  ownerName: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, string>> {
  const base: Record<string, string> = ownerName ? { [ownerId]: ownerName } : {};
  try {
    const res = await fetchImpl(
      `/api/v1/cloud/projects/${encodeURIComponent(remoteProjectId)}/members`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    if (!res.ok) return base;

    const payload = (await res.json()) as { members?: unknown } | null;
    const raw = payload?.members;
    if (!Array.isArray(raw)) return base;

    const memberNames: Record<string, string> = { ...base };
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const m = item as Record<string, unknown>;
      if (typeof m.userId !== "string" || typeof m.name !== "string") continue;
      memberNames[m.userId] = m.name;
    }
    return memberNames;
  } catch {
    return base;
  }
}

async function fetchRoomBootstrap(
  remoteProjectId: string,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<RoomBootstrapInfo> {
  const { myRole, ownerId, ownerName, holderId } = await fetchBatonBootstrap(
    remoteProjectId,
    userId,
    fetchImpl,
  );
  const memberNames =
    myRole === "owner"
      ? await fetchOwnerMemberNames(remoteProjectId, ownerId, ownerName, fetchImpl)
      : ownerName
        ? { [ownerId]: ownerName }
        : {};
  return { myRole, ownerId, ownerName, holderId, memberNames };
}

/**
 * Nối lớp cộng tác Yjs P2P + ResultBroadcaster + Baton thuần DataChannel + `natWarning`
 * vào workspace khi dự án đang mở có `cloud.remoteId`.
 * Dự án local thường (`remoteProjectId === null`) không phát sinh bất kỳ network call nào.
 */
export function useLabRoomCollab({
  remoteProjectId,
  activeTabId,
  activeTabPosition = null,
  initialTabSql = "",
  userId,
  onRemoteResult,
  deps,
}: UseLabRoomCollabOptions): UseLabRoomCollabResult {
  const [session, setSession] = useState<RoomSession | null>(null);
  const depsRef = useRef(deps);
  const onRemoteResultRef = useRef(onRemoteResult);
  const initialTabSqlRef = useRef(initialTabSql);
  useEffect(() => {
    depsRef.current = deps;
    onRemoteResultRef.current = onRemoteResult;
    initialTabSqlRef.current = initialTabSql;
  });

  useEffect(() => {
    if (!remoteProjectId || !userId) {
      if (useBatonStore.getState().projectId !== null) {
        useBatonStore.getState().reset();
      }
      return;
    }

    let cancelled = false;
    let provider: RoomCollabProvider | null = null;
    let broadcaster: ResultBroadcaster | null = null;
    let unsubControl: (() => void) | null = null;
    let unsubNat: (() => void) | null = null;
    let unsubResult: (() => void) | null = null;
    let unsubAwareness: (() => void) | null = null;

    const setup = async () => {
      const currentDeps = depsRef.current;
      const fetchImpl = currentDeps?.fetchImpl ?? fetch;
      const createProvider = currentDeps?.createProvider ?? createRoomCollabProvider;
      const createBroadcaster = currentDeps?.createBroadcaster ?? createResultBroadcaster;

      const { myRole, ownerId, holderId, memberNames } = await fetchRoomBootstrap(
        remoteProjectId,
        userId,
        fetchImpl,
      );
      if (cancelled) return;

      const effectiveHolderId = holderId ?? ownerId;
      const batonStore = useBatonStore.getState();
      batonStore.setRoom({
        projectId: remoteProjectId,
        myUserId: userId,
        myRole,
        holderId: effectiveHolderId,
      });
      batonStore.setMemberNames(memberNames);

      const customSignalUrl = currentDeps?.resolveSignalUrl
        ? await currentDeps.resolveSignalUrl(remoteProjectId)
        : undefined;
      if (cancelled) return;

      provider = createProvider({
        projectId: remoteProjectId,
        userId,
        ...(customSignalUrl
          ? { signalUrl: customSignalUrl }
          : currentDeps?.resolveSignalUrl
            ? {}
            : {
                resolveSignalUrl: async () => {
                  const { ticket } = await requestSignalTicket(remoteProjectId, fetchImpl);
                  return buildDirectSignalUrl(remoteProjectId, ticket);
                },
              }),
      });

      broadcaster = createBroadcaster({
        sendControl: provider.sendControl,
        onControl: provider.onControl,
        ownerId,
      });

      useBatonStore.getState().setTransport({
        sendControl: provider.sendControl,
      });

      unsubControl = provider.onControl((msg) => {
        if (isBatonControlMessage(msg)) {
          useBatonStore.getState().applyControlMessage(msg);
        }
      });

      unsubNat = broadcaster.onNatWarning((visible) => {
        useBatonStore.getState().setNatWarning(visible);
      });

      unsubResult = broadcaster.onResult((res) => {
        onRemoteResultRef.current?.(res);
      });

      const activeProvider = provider;
      const activeBroadcaster = broadcaster;
      const checkConnectedPeers = () => {
        if (
          activeProvider.getPeerIds().length > 0 ||
          activeProvider.awareness.getStates().size > 1
        ) {
          activeBroadcaster.reportPeerConnected();
        }
      };

      const onAwarenessChange = () => {
        checkConnectedPeers();
      };
      activeProvider.awareness.on("change", onAwarenessChange);
      unsubAwareness = () => {
        activeProvider.awareness.off("change", onAwarenessChange);
      };

      activeProvider.connect();
      checkConnectedPeers();

      if (!cancelled) {
        setSession({
          remoteProjectId,
          userId,
          provider: activeProvider,
          broadcaster: activeBroadcaster,
          myRole,
        });
      }
    };

    void setup();

    return () => {
      cancelled = true;
      unsubAwareness?.();
      unsubControl?.();
      unsubNat?.();
      unsubResult?.();
      broadcaster?.destroy();
      provider?.destroy();
      useBatonStore.getState().setTransport(null);
      useBatonStore.getState().reset();
      setSession(null);
    };
  }, [remoteProjectId, userId]);

  const activeSession =
    session &&
    remoteProjectId &&
    userId &&
    session.remoteProjectId === remoteProjectId &&
    session.userId === userId
      ? session
      : null;

  const collabTabKey =
    activeTabPosition !== null && activeTabPosition !== undefined
      ? `pos:${activeTabPosition}`
      : activeTabId;

  useEffect(() => {
    if (!activeSession || !collabTabKey || activeSession.myRole !== "owner") return;
    const seedSql = initialTabSqlRef.current ?? "";
    if (seedSql.length === 0) return;
    const yText = activeSession.provider.doc.getText(`tab:${collabTabKey}`);
    if (yText.length === 0) {
      activeSession.provider.doc.transact(() => {
        if (yText.length === 0) {
          yText.insert(0, seedSql);
        }
      });
    }
  }, [activeSession, collabTabKey]);

  const createTabExt = deps?.createTabExtension ?? createTabCollabExtension;
  const collabExtension = useMemo(() => {
    if (!activeSession || !collabTabKey) return null;
    return createTabExt(
      activeSession.provider.doc,
      collabTabKey,
      activeSession.provider.awareness,
      { readOnly: activeSession.myRole === "viewer" },
    );
  }, [activeSession, collabTabKey, createTabExt]);

  const broadcastResult = useMemo(() => {
    if (!activeSession) return null;
    return (res: P2pExecutionResult) => {
      activeSession.broadcaster.broadcastResult(res);
    };
  }, [activeSession]);

  return { collabExtension, broadcastResult };
}
