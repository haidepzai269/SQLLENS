import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../../../../messages/vi/room.json";
import { AuthProvider } from "@/modules/auth/auth-provider";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceProject } from "@/modules/workspace/types";
import { InviteDialog } from "./invite-dialog";

const CLOUD_ID = "11111111-1111-4111-8111-111111111111";

function project(cloud?: boolean): WorkspaceProject {
  return {
    id: "p-1",
    scopeKey: "user_u1",
    name: "Phòng thử",
    engine: "postgres",
    createdAt: 1,
    updatedAt: 1,
    cloud: cloud ? { remoteId: CLOUD_ID, remoteUpdatedAt: "2026-11-24T00:00:00Z" } : undefined,
  };
}

const roomCalls: string[] = [];

/** fetch giả: /api/me cho AuthProvider, hai route phòng trả dữ liệu thật của hợp đồng Task161. */
function fakeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === "/api/me") {
      return new Response(JSON.stringify({ id: "u1", name: "Tôi", provider: "google" }), { status: 200 });
    }
    if (href.endsWith("/members")) {
      roomCalls.push("members");
      return new Response(
        JSON.stringify({
          members: [
            { userId: "u1", name: "Tôi", avatarUrl: null, role: "owner" },
            { userId: "u2", name: "Bạn", avatarUrl: null, role: "editor" },
          ],
        }),
        { status: 200 },
      );
    }
    if (href.endsWith("/invite") && init?.method === "POST") {
      roomCalls.push("invite");
      return new Response(
        JSON.stringify({ token: "tok-abc", role: "editor", expiresAt: "2026-11-25T10:00:00Z" }),
        { status: 200 },
      );
    }
    throw new Error(`URL lạ trong test: ${href}`);
  });
}

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="vi" messages={{ room: viMessages }}>
      <AuthProvider>
        <InviteDialog />
      </AuthProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  roomCalls.length = 0;
  useWorkspaceStore.setState({ projects: [project(true)], activeProjectId: "p-1", tabs: [], activeTabId: null });
  vi.stubGlobal("fetch", fakeFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Ca "clipboard bị chặn" tự gắn navigator.clipboard giả; dọn để không rò sang ca khác.
  delete (navigator as { clipboard?: unknown }).clipboard;
  useWorkspaceStore.setState({ projects: [], tabs: [], activeProjectId: null, activeTabId: null });
});

describe("InviteDialog", () => {
  it("hiện danh sách thành viên với vai trò, rồi tạo liên kết mời", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    await waitFor(() => expect(screen.getAllByTestId("room-member-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("room-member-row").map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Tôi");
    expect(rows[0]).toContain("Chủ phòng");
    expect(rows[1]).toContain("Bạn");
    expect(rows[1]).toContain("Biên tập");

    fireEvent.click(screen.getByTestId("room-invite-create"));
    const link = await screen.findByTestId("room-invite-link");
    expect((link as HTMLInputElement).value).toContain("/vi/join?token=tok-abc");
    expect(roomCalls).toEqual(["members", "invite"]);
  });

  it("dự án chưa lưu cloud thì hướng dẫn lưu trước và không gọi endpoint phòng nào", async () => {
    useWorkspaceStore.setState({ projects: [project(false)], activeProjectId: "p-1" });
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    expect(await screen.findByTestId("room-invite-not-saved")).toBeTruthy();
    expect(screen.queryByTestId("room-invite-create")).toBeNull();
    expect(roomCalls).toEqual([]);
  });

  it("đổi sang dự án khác thì không còn thấy liên kết mời của dự án trước", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    fireEvent.click(await screen.findByTestId("room-invite-create"));
    expect(await screen.findByTestId("room-invite-link")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    // Dự án thứ hai chưa lưu cloud: mở lại phải thấy hướng dẫn lưu trước, không thấy link dự án cũ.
    useWorkspaceStore.setState({
      projects: [project(true), { ...project(false), id: "p-2" }],
      activeProjectId: "p-2",
    });
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    expect(await screen.findByTestId("room-invite-not-saved")).toBeTruthy();
    expect(screen.queryByTestId("room-invite-link")).toBeNull();
  });

  it("dự án khác đã lưu cloud: có lại nút tạo liên kết, không dùng link của dự án trước", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    fireEvent.click(await screen.findByTestId("room-invite-create"));
    expect(await screen.findByTestId("room-invite-link")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    const other = project(true);
    useWorkspaceStore.setState({
      projects: [project(true), { ...other, id: "p-2", cloud: { remoteId: "22222222-2222-4222-8222-222222222222", remoteUpdatedAt: "2026-11-24T00:00:00Z" } }],
      activeProjectId: "p-2",
    });
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    expect(await screen.findByTestId("room-invite-create")).toBeTruthy();
    expect(screen.queryByTestId("room-invite-link")).toBeNull();
  });

  it("clipboard bị chặn: nói rõ chưa sao chép và chọn sẵn liên kết", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    fireEvent.click(await screen.findByTestId("room-invite-create"));
    expect(await screen.findByTestId("room-invite-link")).toBeTruthy();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("chặn"))) },
    });
    fireEvent.click(screen.getByTestId("room-invite-copy"));

    const note = await screen.findByTestId("room-invite-copy-error");
    expect(note.textContent).toContain("Ctrl+C");
    expect(screen.getByTestId("room-invite-copy").textContent).not.toContain("Đã sao chép");
    const input = screen.getByTestId("room-invite-link") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBeGreaterThan(0);
  });

  it("activeProjectId không khớp dự án nào: không mời nhầm dự án đầu tiên", async () => {
    // Trước đây hộp thoại rơi về `projects[0]`, tức mời một phòng khác với màn hình đang mở.
    useWorkspaceStore.setState({ projects: [project(true)], activeProjectId: "p-khong-ton-tai" });
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    expect(await screen.findByTestId("room-invite-not-saved")).toBeTruthy();
    expect(roomCalls).toEqual([]);
  });

  it("liên kết đã hết hạn: báo rõ và vẫn tạo được liên kết mới", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href === "/api/me") {
          return new Response(JSON.stringify({ id: "u1", name: "Tôi", provider: "google" }), { status: 200 });
        }
        if (href.endsWith("/members")) {
          return new Response(JSON.stringify({ members: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ token: "tok-cu", role: "editor", expiresAt: "2020-01-01T00:00:00Z" }),
          { status: 200 },
        );
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    fireEvent.click(await screen.findByTestId("room-invite-create"));

    expect(await screen.findByTestId("room-invite-expired")).toBeTruthy();
    expect(screen.queryByTestId("room-invite-link")).toBeNull();
    // Nút tạo vẫn ở đó: nếu không, vé chết chiếm chỗ và người dùng phải tải lại trang.
    expect(screen.getByTestId("room-invite-create")).toBeTruthy();
  });

  it("đóng hộp thoại khi đang tạo vé: vé về muộn bị bỏ, mở lại vẫn thấy nút tạo", async () => {
    let resolveInvite: ((res: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href === "/api/me") {
          return new Response(JSON.stringify({ id: "u1", name: "Tôi", provider: "google" }), { status: 200 });
        }
        if (href.endsWith("/members")) {
          return new Response(JSON.stringify({ members: [] }), { status: 200 });
        }
        if (href.endsWith("/invite") && init?.method === "POST") {
          return new Promise<Response>((res) => {
            resolveInvite = res;
          });
        }
        throw new Error(`URL lạ trong test: ${href}`);
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    fireEvent.click(await screen.findByTestId("room-invite-create"));
    await waitFor(() => expect(resolveInvite).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await act(async () => {
      resolveInvite!(
        new Response(JSON.stringify({ token: "tok-muon", role: "editor", expiresAt: "2030-01-01T00:00:00Z" }), {
          status: 200,
        }),
      );
    });

    fireEvent.click(screen.getByTestId("room-invite-trigger"));
    expect(await screen.findByTestId("room-invite-create")).toBeTruthy();
    expect(screen.queryByTestId("room-invite-link")).toBeNull();
  });

  it("401: hộp thoại mời đăng nhập thay vì báo phòng hỏng", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href === "/api/me") {
          return new Response(JSON.stringify({ error: { code: "auth_required" } }), { status: 401 });
        }
        return new Response(JSON.stringify({ error: { code: "auth_required" } }), { status: 401 });
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    const note = await screen.findByTestId("room-members-auth");
    expect(note.textContent).toContain("đăng nhập");
    expect(screen.queryByTestId("room-members-error")).toBeNull();
  });

  it("vai trò lạ vẫn hiện thành viên thay vì bỏ hàng", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href === "/api/me") {
          return new Response(JSON.stringify({ id: "u1", name: "Tôi", provider: "google" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            members: [
              { userId: "u1", name: "Tôi", role: "owner" },
              { userId: "u9", name: "Người mới", role: "admin" },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    await waitFor(() => expect(screen.getAllByTestId("room-member-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("room-member-row").map((r) => r.textContent ?? "");
    expect(rows[1]).toContain("Người mới");
    expect(rows[1]).toContain("Thành viên");
  });

  it("thành viên thường nhận 403: nói đúng 'chỉ chủ dự án', không báo lỗi chung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href === "/api/me") {
          return new Response(JSON.stringify({ id: "u2", name: "Bạn", provider: "google" }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: "forbidden", messageKey: "error.forbidden" } }), {
          status: 403,
        });
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("room-invite-trigger"));

    const note = await screen.findByTestId("room-members-forbidden");
    expect(note.textContent).toContain("Chỉ chủ dự án");
  });
});
