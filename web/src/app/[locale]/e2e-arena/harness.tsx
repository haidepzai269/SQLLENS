"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useArenaStore } from "@/modules/arena/arena-store";
import type { ArenaRole } from "@/modules/arena/arena-sync";
import { ArenaView } from "@/modules/arena/components/arena-view";

const DEFAULT_ROOM_ID = "11111111-1111-4111-8111-111111111111";

export function ArenaHarness() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId") ?? DEFAULT_ROOM_ID;
  const rawRole = searchParams.get("role");
  const role: ArenaRole = rawRole === "viewer" ? "viewer" : "host";

  useEffect(() => {
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  }, []);

  return (
    <main className="min-h-screen w-full bg-background">
      <ArenaView roomId={roomId} role={role} />
    </main>
  );
}
