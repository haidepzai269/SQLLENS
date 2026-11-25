import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import arenaEn from "../../../../messages/en/arena.json";
import arenaVi from "../../../../messages/vi/arena.json";
import commonEn from "../../../../messages/en/common.json";
import commonVi from "../../../../messages/vi/common.json";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { useArenaStore } from "../arena-store";
import { ArenaView } from "../components/arena-view";
import {
  ARENA_MENTOR_ENDPOINT,
  ARENA_MENTOR_TIMEOUT_MS,
  analyzeArenaStepWithMentor,
  buildArenaMentorPrompt,
} from "./arena-mentor-prompt";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

function renderArenaView({
  locale = "vi",
  isVip,
  fetchImpl,
}: {
  locale?: "vi" | "en";
  isVip?: boolean;
  fetchImpl?: typeof fetch;
} = {}) {
  const messages = {
    arena: locale === "vi" ? arenaVi : arenaEn,
    common: locale === "vi" ? commonVi : commonEn,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ArenaView isVip={isVip} fetchImpl={fetchImpl} />
    </NextIntlClientProvider>
  );
}

describe("Arena AI Mentor (Task170)", () => {
  beforeEach(() => {
    useArenaStore.setState({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 3,
      isPlaying: false,
      autoPlaySpeedMs: 500,
    });
  });

  it("AC1: ẩn nút và phát sinh 0 request khi isVip không truyền hoặc isVip=false", () => {
    const fetchSpy = vi.fn<typeof fetch>();

    const { unmount } = renderArenaView({ fetchImpl: fetchSpy });
    expect(screen.queryByTestId("arena-mentor-trigger")).toBeNull();
    expect(screen.queryByTestId("arena-mentor-panel")).toBeNull();
    unmount();

    renderArenaView({ isVip: false, fetchImpl: fetchSpy });
    expect(screen.queryByTestId("arena-mentor-trigger")).toBeNull();
    expect(screen.queryByTestId("arena-mentor-panel")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AC1: hiển thị nút Phân tích với AI Mentor khi isVip=true (vi và en)", () => {
    const { unmount } = renderArenaView({ locale: "vi", isVip: true });
    const viBtn = screen.getByTestId("arena-mentor-trigger");
    expect(viBtn).toBeTruthy();
    expect(viBtn.textContent).toContain("Phân tích với AI Mentor");
    unmount();

    renderArenaView({ locale: "en", isVip: true });
    const enBtn = screen.getByTestId("arena-mentor-trigger");
    expect(enBtn).toBeTruthy();
    expect(enBtn.textContent).toContain("Analyze with AI Mentor");
  });

  it("AC2 & AC4: prompt chỉ lấy từ conflict-sim, tuyệt đối không chứa SQL từ workspace store, gọi đúng /api/ai/inline-complete", async () => {
    const secretSql = "SELECT * FROM secret_user_table WHERE token = 'top_secret_123'";
    useWorkspaceStore.setState({
      projects: [
        {
          id: "proj-secret",
          scopeKey: "guest",
          name: "Secret Project",
          engine: "postgres",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      tabs: [
        {
          id: "tab-secret",
          projectId: "proj-secret",
          name: "secret.sql",
          sql: secretSql,
          position: 0,
          updatedAt: 1,
        },
      ],
      activeProjectId: "proj-secret",
      activeTabId: "tab-secret",
    });

    const promptPayload = buildArenaMentorPrompt({
      scenarioId: "deadlock_reverse_order",
      stepIndex: 3,
      locale: "vi",
    });

    const serializedPrompt = JSON.stringify(promptPayload);
    expect(serializedPrompt).not.toContain("secret_user_table");
    expect(serializedPrompt).not.toContain("top_secret_123");
    expect(serializedPrompt).toContain("deadlock_reverse_order");
    expect(serializedPrompt).toContain("40P01");

    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          completion: "Hai giao dịch giữ khóa đối ứng tạo chu trình chờ vòng tròn.",
          finishReason: "stop",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    renderArenaView({ locale: "vi", isVip: true, fetchImpl: fetchSpy });

    fireEvent.click(screen.getByTestId("arena-mentor-trigger"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/ai/inline-complete");
    expect(url).toBe(ARENA_MENTOR_ENDPOINT);
    expect(String(url)).not.toContain("/api/v1/");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");

    const bodyText = String(init?.body ?? "");
    expect(bodyText).not.toContain("secret_user_table");
    expect(bodyText).not.toContain("top_secret_123");
    expect(bodyText).toContain("deadlock_reverse_order");
  });

  it("AC3: hiển thị phản hồi AI kèm nhãn Mô phỏng (vi/en)", async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          completion: "Giải pháp: sắp xếp thứ tự cập nhật tài khoản nhất quán theo id tăng dần.",
          finishReason: "stop",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    renderArenaView({ locale: "vi", isVip: true, fetchImpl: fetchSpy });
    fireEvent.click(screen.getByTestId("arena-mentor-trigger"));

    const resultCard = await screen.findByTestId("arena-mentor-result");
    expect(resultCard.textContent).toContain("sắp xếp thứ tự cập nhật");

    const badge = screen.getByTestId("arena-mentor-simulation-badge");
    expect(badge.getAttribute("data-label")).toBe("simulated");
    expect(badge.textContent).toContain("Mô phỏng");
  });

  it("AC3: xử lý an toàn lỗi 401/403/429/500, lỗi mạng, completion rỗng và cho phép thử lại", async () => {
    const cases: Array<{ status: number; expectedKind: string }> = [
      { status: 401, expectedKind: "unauthorized" },
      { status: 403, expectedKind: "vip_required" },
      { status: 429, expectedKind: "rate_limited" },
      { status: 500, expectedKind: "server_error" },
    ];

    for (const c of cases) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: c.expectedKind }), { status: c.status })
      );
      const res = await analyzeArenaStepWithMentor(
        { scenarioId: "deadlock_reverse_order", stepIndex: 3, locale: "vi" },
        fetchMock
      );
      expect(res).toEqual({ ok: false, errorKind: c.expectedKind });
    }

    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ completion: "   " }), { status: 200 })
    );
    expect(
      await analyzeArenaStepWithMentor(
        { scenarioId: "deadlock_reverse_order", stepIndex: 3, locale: "vi" },
        emptyFetch
      )
    ).toEqual({ ok: false, errorKind: "empty_response" });

    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    expect(
      await analyzeArenaStepWithMentor(
        { scenarioId: "deadlock_reverse_order", stepIndex: 3, locale: "vi" },
        networkFetch
      )
    ).toEqual({ ok: false, errorKind: "network_error" });

    // Kiểm tra UI hiển thị lỗi 429 và nút Retry gọi lại thành công
    const uiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ completion: "Phân tích thành công sau khi thử lại." }), {
          status: 200,
        })
      );

    renderArenaView({ locale: "vi", isVip: true, fetchImpl: uiFetch });
    fireEvent.click(screen.getByTestId("arena-mentor-trigger"));

    const errorBox = await screen.findByTestId("arena-mentor-error");
    expect(errorBox.textContent).toContain("quá nhiều yêu cầu");

    fireEvent.click(screen.getByTestId("arena-mentor-retry"));

    const resultCard = await screen.findByTestId("arena-mentor-result");
    expect(resultCard.textContent).toContain("Phân tích thành công sau khi thử lại.");
    expect(uiFetch).toHaveBeenCalledTimes(2);
  });

  it("Ca biên: đổi bước hoặc kịch bản sẽ xóa kết quả cũ và abort request đang chờ", async () => {
    let capturedSignal: AbortSignal | undefined;
    const pendingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    renderArenaView({ locale: "vi", isVip: true, fetchImpl: pendingFetch });
    const trigger = screen.getByTestId("arena-mentor-trigger") as HTMLButtonElement;
    fireEvent.click(trigger);

    expect(trigger.disabled).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);

    act(() => {
      useArenaStore.getState().setStep(4);
    });

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
      expect((screen.getByTestId("arena-mentor-trigger") as HTMLButtonElement).disabled).toBe(
        false
      );
    });
    expect(screen.queryByTestId("arena-mentor-error")).toBeNull();
    expect(screen.queryByTestId("arena-mentor-result")).toBeNull();
  });

  it("Ca biên: hết timeout nội bộ 10s trả về network_error, tắt spinner và hiện nút thử lại", async () => {
    vi.useFakeTimers();

    const hangingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const promise = analyzeArenaStepWithMentor(
      { scenarioId: "deadlock_reverse_order", stepIndex: 3, locale: "vi" },
      hangingFetch
    );

    await vi.advanceTimersByTimeAsync(ARENA_MENTOR_TIMEOUT_MS);
    await expect(promise).resolves.toEqual({ ok: false, errorKind: "network_error" });

    renderArenaView({ locale: "vi", isVip: true, fetchImpl: hangingFetch });
    const trigger = screen.getByTestId("arena-mentor-trigger") as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(trigger.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARENA_MENTOR_TIMEOUT_MS);
    });

    expect((screen.getByTestId("arena-mentor-trigger") as HTMLButtonElement).disabled).toBe(false);
    const errorBox = screen.getByTestId("arena-mentor-error");
    expect(errorBox.textContent).toContain("Không thể kết nối");
    expect(screen.getByTestId("arena-mentor-retry")).toBeTruthy();
  });
});
