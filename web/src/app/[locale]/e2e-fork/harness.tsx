"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ForkDialog } from "@/modules/room/fork/fork-dialog";
import {
  ROOM_FORK_MAX_BYTES,
  countActiveForks,
  forkRoomToWorkspace,
  type RoomForkInput,
} from "@/modules/room/fork/room-fork";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import type { WorkspaceScope } from "@/modules/workspace/types";

const ORIGIN_PROJECT_ID = "room-origin-e2e";

export function ForkHarness() {
  const t = useTranslations("share.roomFork");
  const params = useSearchParams();
  const mode = params.get("mode") ?? "normal";
  const userId = params.get("userId");
  const scope: WorkspaceScope = useMemo(
    () => (userId ? { kind: "user", userId } : { kind: "guest" }),
    [userId],
  );

  const room: RoomForkInput = useMemo(() => {
    const baseTabs = [
      { name: "01_schema.sql", sql: "CREATE TABLE orders (id INT PRIMARY KEY, total INT);" },
      { name: "02_seed.sql", sql: "INSERT INTO orders VALUES (1, 100), (2, 250);" },
      { name: "03_query.sql", sql: "SELECT id, total FROM orders WHERE total > 50;" },
    ];
    if (mode === "oversized") {
      return {
        projectId: ORIGIN_PROJECT_ID,
        projectName: "Phòng thực hành E2E",
        engine: "postgres",
        tabs: [
          ...baseTabs.slice(0, 2),
          { name: "oversized_tab.sql", sql: "X".repeat(ROOM_FORK_MAX_BYTES + 256) },
        ],
      };
    }
    return {
      projectId: ORIGIN_PROJECT_ID,
      projectName: "Phòng thực hành E2E",
      engine: "postgres",
      tabs: baseTabs,
    };
  }, [mode]);

  const [lastForkId, setLastForkId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const db = await openWorkspaceDb();
      try {
        const repo = getRepository(db);
        const existing = await repo.getProject(ORIGIN_PROJECT_ID);
        if (!existing) {
          await repo.putProjectWithTabs(
            {
              id: ORIGIN_PROJECT_ID,
              scopeKey: scope.kind === "guest" ? "guest" : `user_${scope.userId}`,
              name: room.projectName,
              engine: room.engine,
              createdAt: 1000,
              updatedAt: 1000,
            },
            room.tabs.map((t, idx) => ({
              id: `origin-tab-${idx}`,
              projectId: ORIGIN_PROJECT_ID,
              name: t.name,
              sql: t.sql,
              position: idx,
              updatedAt: 1000,
            })),
          );
        }
      } finally {
        db.close();
      }

      if (active) {
        (window as unknown as Record<string, unknown>).__e2eForkApi = {
          forkRoomToWorkspace,
          countActiveForks,
          room,
          scope,
          async readWorkspace() {
            const db2 = await openWorkspaceDb();
            try {
              const repo = getRepository(db2);
              const projects = await repo.listProjects(scope);
              const tabsByProject: Record<string, { name: string; sql: string; position: number }[]> = {};
              for (const p of projects) {
                const tabs = await repo.listTabs(p.id);
                tabsByProject[p.id] = tabs.map((t) => ({
                  name: t.name,
                  sql: t.sql,
                  position: t.position,
                }));
              }
              return { projects, tabsByProject };
            } finally {
              db2.close();
            }
          },
        };
        setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [room, scope]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <ForkDialog
          room={room}
          scope={scope}
          onForked={(res) => setLastForkId(res.projectId)}
        />
      </div>
      <div data-testid="e2e-fork-ready">{ready ? "ready" : "loading"}</div>
      <div data-testid="last-fork-id">{lastForkId ?? ""}</div>
    </main>
  );
}
