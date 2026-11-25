import { describe, expect, it, vi } from "vitest";
import { createInvite, inviteUrl, joinRoom, listMembers, RoomApiError } from "./api";

/** fetch giả trả một body JSON với mã cho trước, đồng thời ghi lại request để kiểm. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("room api", () => {
  it("createInvite gọi đúng đường dẫn, không gửi body, trả vé hợp lệ", async () => {
    const f = fakeFetch(200, { token: "tok-1", role: "editor", expiresAt: "2026-11-25T00:00:00Z" });
    const invite = await createInvite("11111111-1111-4111-8111-111111111111", { fetchImpl: f.impl });
    expect(invite).toEqual({ token: "tok-1", role: "editor", expiresAt: "2026-11-25T00:00:00Z" });
    expect(f.calls[0].url).toBe(
      "/api/v1/cloud/projects/11111111-1111-4111-8111-111111111111/invite",
    );
    expect(f.calls[0].init?.method).toBe("POST");
    expect(f.calls[0].init?.body).toBeUndefined();
  });

  it("joinRoom gửi đúng token và trả alreadyMember", async () => {
    const f = fakeFetch(200, { projectId: "p-1", role: "editor", alreadyMember: true });
    const res = await joinRoom("tok-1", { fetchImpl: f.impl });
    expect(res).toEqual({ projectId: "p-1", role: "editor", alreadyMember: true });
    expect(f.calls[0].url).toBe("/api/v1/cloud/projects/join");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ token: "tok-1" });
  });

  it("joinRoom giữ nguyên mã 410 token_expired để giao diện nói 'xin link mới'", async () => {
    const f = fakeFetch(410, { error: { code: "token_expired", messageKey: "error.notFound" } });
    const err = await joinRoom("old", { fetchImpl: f.impl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomApiError);
    expect(err).toMatchObject({ status: 410, code: "token_expired" });
  });

  it("listMembers giữ vai trò lạ với nhãn unknown và bỏ hàng thiếu userId", async () => {
    const f = fakeFetch(200, {
      members: [
        { userId: "u1", name: "A", avatarUrl: null, role: "owner" },
        { userId: "u2", name: "B", avatarUrl: "https://x/b.png", role: "editor" },
        { userId: "u3", name: "C", role: "khong-phai-vai-tro" },
        { name: "khong-co-id", role: "editor" },
        "rac",
      ],
    });
    const members = await listMembers("p-1", { fetchImpl: f.impl });
    expect(members).toEqual([
      { userId: "u1", name: "A", role: "owner" },
      { userId: "u2", name: "B", role: "editor" },
      { userId: "u3", name: "C", role: "unknown" },
    ]);
    expect(f.calls[0].url).toBe("/api/v1/cloud/projects/p-1/members");
  });

  it("403 khi đọc thành viên là lỗi có mã, để giao diện phân biệt với lỗi mạng", async () => {
    const f = fakeFetch(403, { error: { code: "forbidden", messageKey: "error.forbidden" } });
    await expect(listMembers("p-1", { fetchImpl: f.impl })).rejects.toMatchObject({ status: 403 });
  });

  it("body thiếu trường là invalid_response, không trả object nửa vời", async () => {
    const f = fakeFetch(200, { token: "", role: "editor", expiresAt: "x" });
    await expect(createInvite("p-1", { fetchImpl: f.impl })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("inviteUrl đặt token vào query và mã hoá ký tự đặc biệt", () => {
    expect(inviteUrl("https://a.dev", "vi", "a+b/c=")).toBe("https://a.dev/vi/join?token=a%2Bb%2Fc%3D");
  });

  it("request của module room không mang nội dung SQL (Core Rule 7)", async () => {
    // Kiểm CẢ BA lời gọi, không chỉ `createInvite`: body `undefined` của nó xanh ngay cả khi
    // `joinRoom` lỡ gửi kèm nội dung tab, nên chỉ soi một hàm thì test không chứng minh được gì.
    const f = fakeFetch(200, {
      token: "t",
      role: "editor",
      expiresAt: "x",
      projectId: "p-1",
      alreadyMember: false,
      members: [{ userId: "u1", name: "A", role: "owner" }],
    });
    await createInvite("p-1", { fetchImpl: f.impl });
    await joinRoom("t", { fetchImpl: f.impl });
    await listMembers("p-1", { fetchImpl: f.impl });
    expect(f.calls).toHaveLength(3);
    const sent = f.calls.map((c) => `${c.url} ${String(c.init?.body ?? "")}`).join("\n");
    // Phân biệt hoa/thường là cố ý: đường dẫn có chữ "join" thường, còn SQL thì viết hoa.
    expect(sent).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/);
  });
});
