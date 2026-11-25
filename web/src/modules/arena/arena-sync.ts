"use client";

// Đồng bộ bước Deadlock Arena Host -> Viewer qua REST polling chu kỳ 3 giây (D17).
// Tuyệt đối không gửi SQL người dùng ra mạng (Core Rule 7): payload chỉ mang `{ step: number }`.

import { useEffect } from "react";
import { useArenaStore } from "./arena-store";

export const ARENA_POLL_INTERVAL_MS = 3000;

export type ArenaRole = "host" | "viewer";

function arenaStepUrl(roomId: string): string {
  return `/api/v1/cloud/projects/${encodeURIComponent(roomId)}/arena-step`;
}

/**
 * Host đẩy bước hiện tại lên server. Payload chỉ chứa `{ step }` (0 byte SQL).
 */
export async function pushArenaStep(
  roomId: string,
  step: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const safeStep = Math.max(0, Math.floor(step));
  const res = await fetchImpl(arenaStepUrl(roomId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: safeStep }),
  });

  if (!res.ok) {
    throw new Error(`POST /arena-step failed with status ${res.status}`);
  }

  const data = (await res.json()) as { step?: unknown };
  return typeof data?.step === "number" && Number.isFinite(data.step) ? data.step : safeStep;
}

/**
 * Viewer lấy bước hiện tại từ server.
 */
export async function fetchArenaStep(
  roomId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(arenaStepUrl(roomId), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`GET /arena-step failed with status ${res.status}`);
  }

  const data = (await res.json()) as { step?: unknown };
  if (typeof data?.step !== "number" || !Number.isFinite(data.step)) {
    throw new Error("Invalid arena step payload");
  }
  return data.step;
}

export interface StartArenaPollingOptions {
  roomId: string;
  fetchImpl?: typeof fetch;
  onStep?: (step: number) => void;
  onError?: (error: unknown) => void;
}

/**
 * Bắt đầu polling bước Arena đúng mỗi `ARENA_POLL_INTERVAL_MS` (3000ms).
 * Trả về hàm cleanup dừng hẳn timer.
 */
export function startArenaPolling({
  roomId,
  fetchImpl = fetch,
  onStep,
  onError,
}: StartArenaPollingOptions): () => void {
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    void fetchArenaStep(roomId, fetchImpl)
      .then((step) => {
        if (stopped) return;
        if (onStep) {
          onStep(step);
        } else {
          useArenaStore.getState().setStep(step);
        }
      })
      .catch((err) => {
        if (!stopped) {
          onError?.(err);
        }
      });
  };

  const timer = setInterval(tick, ARENA_POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export interface UseArenaSyncOptions {
  roomId?: string;
  role?: ArenaRole;
  fetchImpl?: typeof fetch;
}

/**
 * Hook đồng bộ Arena theo vai trò:
 * - `host`: đẩy `{ step }` mỗi khi `stepIndex` thay đổi.
 * - `viewer`: poll mỗi 3000ms và cập nhật `useArenaStore.getState().setStep(step)`.
 */
export function useArenaSync({ roomId, role, fetchImpl }: UseArenaSyncOptions): void {
  const stepIndex = useArenaStore((s) => s.stepIndex);

  useEffect(() => {
    if (!roomId || role !== "host") return;
    void pushArenaStep(roomId, stepIndex, fetchImpl).catch(() => {
      // Lỗi mạng tạm thời không làm crash giao diện Arena.
    });
  }, [roomId, role, stepIndex, fetchImpl]);

  useEffect(() => {
    if (!roomId || role !== "viewer") return;
    const stop = startArenaPolling({
      roomId,
      fetchImpl,
      onStep: (step) => {
        useArenaStore.getState().setStep(step);
      },
    });
    return stop;
  }, [roomId, role, fetchImpl]);
}
