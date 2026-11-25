import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import viRoom from "../../../messages/vi/room.json";
import { AuthProvider } from "@/modules/auth/auth-provider";
import { CloudSyncError } from "@/modules/cloud/sync";
import { JoinRoomPage } from "./join-room-page";
import { ensureJoinedProject } from "./join";

/**
 * Trang `/join` dùng `useSearchParams`/`useRouter` của Next, nên cả hai bị thay bằng bản giả. Token
 * đổi được giữa các ca để kiểm cả link thiếu mã.
 */
const nav = vi.hoisted(() => ({
  token: "tok-1",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.token ? `token=${nav.token}` : ""),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    "data-testid"?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Chỉ thay bước ghi IndexedDB: `classifyJoinError` vẫn là bản thật để câu lỗi được kiểm đúng đường.
vi.mock("./join", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./join")>();
  return { ...actual, ensureJoinedProject: vi.fn() };
});

const assign = vi.fn();

function renderPage() {
  return render(
    <NextIntlClientProvider locale="vi" messages={{ room: viRoom }}>
      <AuthProvider>
        <JoinRoomPage />
      </AuthProvider>
    </NextIntlClientProvider>,
  );
}

/** `/api/me` trả mã cho trước; các route phòng còn lại do từng ca quyết định qua `extra`. */
function stubFetch(meStatus: number, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/me") {
        return meStatus === 200
          ? new Response(JSON.stringify({ id: "u1", name: "Tôi", provider: "google", role: "user", vipUntil: null }), {
              status: 200,
            })
          : new Response(JSON.stringify({ error: { code: "x" } }), { status: meStatus });
      }
      const handled = extra?.(href, init);
      if (handled) return handled;
      throw new Error(`URL lạ trong test: ${href}`);
    }),
  );
}

beforeEach(() => {
  nav.token = "tok-1";
  nav.replace.mockClear();
  assign.mockClear();
  // `location.assign` của jsdom chỉ báo "not implemented"; thay bằng hàm giả để ca "đã tham gia"
  // dừng lại ở màn hình đó và kiểm được đường dự phòng.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "http://localhost:3000", pathname: "/vi/join", search: "?token=tok-1", hash: "", assign },
  });
  (ensureJoinedProject as Mock).mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JoinRoomPage", () => {
  it("chưa đăng nhập: có nút đăng nhập và đường về trang chủ, không chỉ điều hướng tự động", async () => {
    stubFetch(401);
    renderPage();

    expect(await screen.findByTestId("room-join-signed-out")).toBeTruthy();
    expect(screen.getByTestId("room-join-signin").textContent).toContain("Đăng nhập");
    expect(screen.getByRole("link", { name: "Về trang chủ" }).getAttribute("href")).toBe("/");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("/vi/login?next=")));
  });

  it("máy chủ không trả lời: nói đúng là không kết nối được, không mời đăng nhập vô vọng", async () => {
    stubFetch(500);
    renderPage();

    const box = await screen.findByTestId("room-join-error");
    expect(box.textContent).toContain("Không kết nối được máy chủ");
    expect(screen.queryByTestId("room-join-signin")).toBeNull();
    expect(box.textContent).not.toContain("Thử lại");
  });

  it("đã tham gia xong: có đường mở workspace nếu điều hướng tự động bị chặn", async () => {
    stubFetch(200, (href, init) =>
      href.endsWith("/join") && init?.method === "POST"
        ? new Response(JSON.stringify({ projectId: "p-1", role: "editor", alreadyMember: false }), { status: 200 })
        : undefined,
    );
    (ensureJoinedProject as Mock).mockResolvedValue({ projectId: "p-1", pulled: true });
    renderPage();

    fireEvent.click(await screen.findByTestId("room-join-button"));

    expect(await screen.findByTestId("room-join-done")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Mở workspace" });
    expect(link.getAttribute("href")).toBe("/");
    expect(assign).toHaveBeenCalledWith("/vi");
  });

  it("đã tham gia trên server nhưng lỗi lưu máy: báo rõ đã vào phòng và cho mở workspace + thử lại", async () => {
    stubFetch(200, (href, init) =>
      href.endsWith("/join") && init?.method === "POST"
        ? new Response(JSON.stringify({ projectId: "p-1", role: "editor", alreadyMember: false }), { status: 200 })
        : undefined,
    );
    (ensureJoinedProject as Mock).mockRejectedValue(
      new CloudSyncError("STORAGE_UNAVAILABLE", "IndexedDB blocked"),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("room-join-button"));

    const box = await screen.findByTestId("room-join-error");
    expect(box.textContent).toContain("Bạn đã tham gia phòng, nhưng trình duyệt không cho lưu bản sao trên máy này");
    const openWs = screen.getByTestId("room-join-open-workspace");
    expect(openWs.getAttribute("href")).toBe("/");
    expect(box.querySelector("button")?.textContent).toContain("Thử lại");
  });

  it("đã tham gia trên server nhưng lỗi kéo/lưu khác: báo joinedSaveFailed và cho mở workspace + thử lại", async () => {
    stubFetch(200, (href, init) =>
      href.endsWith("/join") && init?.method === "POST"
        ? new Response(JSON.stringify({ projectId: "p-1", role: "editor", alreadyMember: false }), { status: 200 })
        : undefined,
    );
    (ensureJoinedProject as Mock).mockRejectedValue(new CloudSyncError("NETWORK", "timeout"));
    renderPage();

    fireEvent.click(await screen.findByTestId("room-join-button"));

    const box = await screen.findByTestId("room-join-error");
    expect(box.textContent).toContain("Bạn đã tham gia phòng, nhưng chưa lưu được bản sao trên máy này");
    expect(screen.getByTestId("room-join-open-workspace").getAttribute("href")).toBe("/");
    expect(box.querySelector("button")?.textContent).toContain("Thử lại");
  });
});
