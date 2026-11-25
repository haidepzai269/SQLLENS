"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useBatonStore } from "@/modules/room/collab/baton-store";
import type { RoomRole } from "@/modules/room/collab/types";
import { NatWarningBanner } from "@/modules/room/components/nat-warning-banner";
import { createResultBroadcaster } from "@/modules/room/p2p/result-broadcaster";
import {
  BATON_RETURN_TIMEOUT_MS,
  NAT_WARNING_TIMEOUT_MS,
  type P2pExecutionResult,
  type ResultBroadcaster,
} from "@/modules/room/p2p/types";

function parseRole(raw: string | null): RoomRole {
  if (raw === "owner" || raw === "editor" || raw === "viewer") return raw;
  return "editor";
}

function parseMs(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function P2pHarness() {
  const t = useTranslations("room.p2p");
  const params = useSearchParams();
  const projectId = params.get("projectId") ?? "proj-p2p-e2e";
  const userId = params.get("userId") ?? "u-a";
  const role = parseRole(params.get("role"));
  const ownerId = params.get("ownerId") ?? "u-a";
  const initialHolderId = params.get("holderId") ?? ownerId;
  const returnTimeoutMs = parseMs(params.get("returnMs"), BATON_RETURN_TIMEOUT_MS);
  const natTimeoutMs = parseMs(params.get("natMs"), NAT_WARNING_TIMEOUT_MS);
  const simulateNatFail = params.get("simulateNatFail") === "1";

  const holderId = useBatonStore((s) => s.holderId);
  const [natWarning, setNatWarning] = useState(false);
  const [latestResult, setLatestResult] = useState<P2pExecutionResult | null>(null);
  const [batonReturnedMsg, setBatonReturnedMsg] = useState<string | null>(null);

  const broadcasterRef = useRef<ResultBroadcaster | null>(null);

  const controlListeners = useMemo(
    () => new Set<(message: unknown, fromPeerId: string) => void>(),
    [],
  );

  useEffect(() => {
    const store = useBatonStore.getState();
    store.setRoom({
      projectId,
      myUserId: userId,
      myRole: role,
      holderId: initialHolderId,
    });

    const broadcaster = createResultBroadcaster({
      ownerId,
      returnTimeoutMs,
      natTimeoutMs,
      sendControl: (message) => {
        void fetch("/api/e2e-p2p/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromPeerId: userId, message }),
        });
      },
      onControl: (cb) => {
        controlListeners.add(cb);
        return () => {
          controlListeners.delete(cb);
        };
      },
    });
    broadcasterRef.current = broadcaster;

    const offResult = broadcaster.onResult((result) => {
      setLatestResult(result);
    });
    const offNat = broadcaster.onNatWarning((warning) => {
      setNatWarning(warning);
    });
    const offReturned = broadcaster.onBatonReturned((msg) => {
      setBatonReturnedMsg(msg.holder);
    });

    if (!simulateNatFail) {
      broadcaster.reportPeerConnected();
    }

    let active = true;
    const pollTimer = setInterval(async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/e2e-p2p/poll?userId=${encodeURIComponent(userId)}`, {
          cache: "no-store",
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          messages?: Array<{ fromPeerId: string; message: unknown }>;
        };
        if (Array.isArray(data.messages)) {
          for (const item of data.messages) {
            for (const listener of controlListeners) {
              listener(item.message, item.fromPeerId);
            }
          }
        }
      } catch {
        // Bỏ qua lỗi mạng trong harness E2E
      }
    }, 100);

    return () => {
      active = false;
      clearInterval(pollTimer);
      offResult();
      offNat();
      offReturned();
      broadcaster.destroy();
      broadcasterRef.current = null;
      useBatonStore.getState().reset();
    };
  }, [
    projectId,
    userId,
    role,
    ownerId,
    initialHolderId,
    returnTimeoutMs,
    natTimeoutMs,
    simulateNatFail,
    controlListeners,
  ]);

  const isDriver = role !== "viewer" && holderId === userId;

  const handleRunSample = () => {
    broadcasterRef.current?.broadcastResult({
      columns: ["id", "label"],
      rows: [[1, "p2p_ok"]],
      rowCount: 1,
      durationMs: 8,
      tabId: "tab-1",
      executedBy: userId,
      sentAt: Date.now(),
    });
  };

  const handleSimulateDisconnect = () => {
    broadcasterRef.current?.handleDriverDisconnected();
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4">
      <NatWarningBanner visible={natWarning} />

      <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-raised p-3 text-xs">
        <span data-testid="p2p-baton-holder" className="min-w-0 break-words font-medium">
          {t("holderStatus", { holder: holderId ?? "-" })}
        </span>
        {isDriver ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="p2p-run-button"
              onClick={handleRunSample}
            >
              {t("runSample")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="p2p-disconnect-button"
              onClick={handleSimulateDisconnect}
            >
              {t("simulateDisconnect")}
            </Button>
          </div>
        ) : null}
      </div>

      {batonReturnedMsg ? (
        <div
          role="status"
          data-testid="p2p-baton-returned"
          className="border border-line bg-raised px-3 py-2 text-xs"
        >
          {t("batonReturned", { holder: batonReturnedMsg })}
        </div>
      ) : null}

      <section
        data-testid="p2p-result-view"
        className="border border-line bg-surface p-3 text-xs"
      >
        {latestResult ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              {t("resultReceived", {
                name: latestResult.executedBy,
                ms: latestResult.durationMs,
              })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    {latestResult.columns.map((col) => (
                      <th key={col} className="border-b border-line px-2 py-1 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestResult.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="border-b border-line/50 px-2 py-1">
                          {String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("noResultYet")}</p>
        )}
      </section>
    </main>
  );
}
