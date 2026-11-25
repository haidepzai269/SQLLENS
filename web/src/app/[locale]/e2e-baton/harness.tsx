"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { LabWorkspace } from "@/modules/lab/lab-workspace";
import { useBatonStore } from "@/modules/room/collab/baton-store";
import type { BatonControlMessage, RoomRole } from "@/modules/room/collab/types";

function parseRole(raw: string | null): RoomRole {
  if (raw === "owner" || raw === "editor" || raw === "viewer") return raw;
  return "editor";
}

function parseNames(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function BatonHarness() {
  const params = useSearchParams();
  const projectId = params.get("projectId") ?? "proj-e2e";
  const userId = params.get("userId") ?? "u-a";
  const role = parseRole(params.get("role"));
  const holderId = params.get("holderId") ?? "u-a";
  const namesParam = params.get("names");

  useEffect(() => {
    const store = useBatonStore.getState();
    store.setRoom({
      projectId,
      myUserId: userId,
      myRole: role,
      holderId,
    });
    store.setMemberNames(parseNames(namesParam));
    store.setTransport({
      sendControl: async (msg) => {
        await fetch("/api/e2e-baton/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg),
        });
      },
    });

    let active = true;
    const timer = setInterval(async () => {
      if (!active) return;
      try {
        const res = await fetch(
          `/api/e2e-baton/poll?userId=${encodeURIComponent(userId)}`,
          { cache: "no-store" },
        );
        if (!res.ok || !active) return;
        const data = (await res.json()) as { messages?: BatonControlMessage[] };
        if (Array.isArray(data.messages)) {
          for (const m of data.messages) {
            useBatonStore.getState().applyControlMessage(m);
          }
        }
      } catch {
        // Bỏ qua lỗi mạng trong harness
      }
    }, 150);

    return () => {
      active = false;
      clearInterval(timer);
      useBatonStore.getState().reset();
    };
  }, [projectId, userId, role, holderId, namesParam]);

  return <LabWorkspace />;
}
