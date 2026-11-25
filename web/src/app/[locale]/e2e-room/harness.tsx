"use client";

import { useEffect } from "react";
import { InviteDialog } from "@/modules/room/components/invite-dialog";
import { useWorkspaceStore } from "@/modules/workspace/store";

const CLOUD_ID = "11111111-1111-4111-8111-111111111111";

export function RoomHarness() {
  useEffect(() => {
    useWorkspaceStore.setState({
      projects: [
        {
          id: "p-room",
          scopeKey: "guest",
          name: "Phòng thử",
          engine: "postgres",
          createdAt: 1,
          updatedAt: 1,
          cloud: { remoteId: CLOUD_ID, remoteUpdatedAt: "2026-11-24T00:00:00Z" },
        },
      ],
      tabs: [],
      activeProjectId: "p-room",
      activeTabId: null,
    });
  }, []);

  return (
    <main className="flex min-w-0 flex-col gap-3 p-4">
      <InviteDialog />
    </main>
  );
}
