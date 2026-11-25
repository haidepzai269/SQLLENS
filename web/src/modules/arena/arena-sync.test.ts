import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useArenaStore } from "./arena-store";
import {
  ARENA_POLL_INTERVAL_MS,
  fetchArenaStep,
  pushArenaStep,
  startArenaPolling,
  useArenaSync,
} from "./arena-sync";

describe("arena-sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 0,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("D17: bắt buộc sử dụng chu kỳ polling 3000ms (không dùng 2000ms)", () => {
    expect(ARENA_POLL_INTERVAL_MS).toBe(3000);
  });

  it("AC3: pushArenaStep và fetchArenaStep chỉ gửi/nhận { step }, 0 byte SQL", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body });

      if (method === "POST") {
        return new Response(JSON.stringify({ step: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ step: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const pushed = await pushArenaStep("room-123", 3, fakeFetch);
    expect(pushed).toBe(3);

    const fetched = await fetchArenaStep("room-123", fakeFetch);
    expect(fetched).toBe(3);

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/v1/cloud/projects/room-123/arena-step");
    expect(calls[0].body).toBe('{"step":3}');

    // Kiểm tra payload không chứa bất kỳ từ khóa/chuỗi SQL nào
    const parsed = JSON.parse(calls[0].body!);
    expect(Object.keys(parsed)).toEqual(["step"]);
    expect(calls[1].method).toBe("GET");
    expect(calls[1].body).toBeUndefined();
  });

  it("AC4: đo tải polling 5 phút liên tục (300_000ms) <= 101 request, đúng chu kỳ 3000ms", async () => {
    let requestCount = 0;
    const fakeFetch: typeof fetch = vi.fn(async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ step: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { unmount } = renderHook(() =>
      useArenaSync({
        roomId: "room-5min",
        role: "viewer",
        fetchImpl: fakeFetch,
      }),
    );

    // Ở thời điểm 2000ms chưa được gửi request nào (khác chu kỳ 2s bị cấm)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(requestCount).toBe(0);

    // Đúng mốc 3000ms có request đầu tiên
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(requestCount).toBe(1);
    expect(useArenaStore.getState().stepIndex).toBe(2);

    // Chạy tiếp phần còn lại cho đủ 5 phút (300_000ms tổng cộng)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(297_000);
    });
    expect(requestCount).toBe(100);
    expect(requestCount).toBeLessThanOrEqual(101);

    // Unmount: dừng hẳn timer, không phát sinh thêm request
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(requestCount).toBe(100);
  });

  it("Ca biên: lỗi 500 hoặc lỗi mạng tạm thời không crash, vẫn tiếp tục chu kỳ sau", async () => {
    let attempt = 0;
    const errors: unknown[] = [];
    const fakeFetch: typeof fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (attempt === 2) {
        throw new Error("Network disconnected");
      }
      return new Response(JSON.stringify({ step: 4 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const stop = startArenaPolling({
      roomId: "room-err",
      fetchImpl: fakeFetch,
      onError: (err) => errors.push(err),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(errors).toHaveLength(1);
    expect(useArenaStore.getState().stepIndex).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(errors).toHaveLength(2);
    expect(useArenaStore.getState().stepIndex).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(useArenaStore.getState().stepIndex).toBe(4);

    stop();
  });

  it("Host mode: tự động đẩy { step } khi khởi tạo và khi stepIndex thay đổi", async () => {
    const sentSteps: number[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { step: number };
      sentSteps.push(body.step);
      return new Response(JSON.stringify({ step: body.step }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    renderHook(() =>
      useArenaSync({
        roomId: "room-host",
        role: "host",
        fetchImpl: fakeFetch,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(sentSteps).toEqual([0]);

    await act(async () => {
      useArenaStore.getState().nextStep();
      await Promise.resolve();
    });
    expect(sentSteps).toEqual([0, 1]);
  });
});
