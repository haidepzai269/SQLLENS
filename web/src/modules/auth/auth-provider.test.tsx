// Test AuthProvider: đường mất phiên phải dọn liên kết cloud còn kẹt trong bộ nhớ.
//
// Vì sao cần: `unpersistedLinks` (Task153) giữ id dự án vừa tạo trên cloud khi bước ghi IndexedDB
// hỏng. Map đó nằm ở cấp module nên sống lâu hơn phiên đăng nhập. Nếu đăng xuất mà không dọn,
// người đăng nhập sau trong cùng tab có thể PUT vào dự án cloud của người trước.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-provider";

const forgetMock = vi.fn();

vi.mock("@/modules/cloud/sync", () => ({
  forgetUnpersistedLinks: () => forgetMock(),
}));

// Provider thật gọi endMysqlSession khi logout; ở đây không kiểm đường đó.
vi.mock("@/engines/mysql/adapter", () => ({ endMysqlSession: async () => {} }));

/** Lấy `markAnon` ra ngoài để bấm được như nút đăng xuất. */
function Probe() {
  const { markAnon, status } = useAuth();
  return (
    <button type="button" data-testid="mark-anon" onClick={markAnon}>
      {status}
    </button>
  );
}

function meResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: "usr_1", name: "An" }),
  } as Response;
}

beforeEach(() => {
  forgetMock.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => meResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthProvider — dọn bộ nhớ cloud khi mất phiên", () => {
  it("markAnon xóa liên kết cloud còn kẹt trong bộ nhớ", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("mark-anon").textContent).toBe("user"));
    expect(forgetMock).not.toHaveBeenCalled();

    screen.getByTestId("mark-anon").click();

    expect(forgetMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("mark-anon").textContent).toBe("anon"));
  });

  it("refreshUser gặp 401 cũng dọn, không chỉ markAnon", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return meResponse();
        return { ok: false, status: 401, json: async () => ({}) } as Response;
      }),
    );

    function RefreshProbe() {
      const { refreshUser, status } = useAuth();
      return (
        <button type="button" data-testid="refresh" onClick={() => void refreshUser()}>
          {status}
        </button>
      );
    }

    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("refresh").textContent).toBe("user"));

    screen.getByTestId("refresh").click();

    await waitFor(() => expect(screen.getByTestId("refresh").textContent).toBe("anon"));
    expect(forgetMock).toHaveBeenCalledTimes(1);
  });
});
