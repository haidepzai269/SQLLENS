import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../../../../messages/vi/room.json";
import enMessages from "../../../../messages/en/room.json";
import { useBatonStore } from "@/modules/room/collab/baton-store";
import { BatonRequestToast } from "./baton-request-toast";

function renderToast(locale: "vi" | "en" = "vi") {
  const messages = locale === "vi" ? { room: viMessages } : { room: enMessages };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BatonRequestToast />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useBatonStore.getState().reset();
});

describe("BatonRequestToast", () => {
  it("không hiển thị khi chưa vào phòng (projectId === null)", () => {
    const { container } = renderToast();
    expect(container.firstChild).toBeNull();
  });

  it("không hiển thị với vai trò viewer (AC4)", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-viewer",
      myRole: "viewer",
      holderId: "u-owner",
    });
    const { container } = renderToast();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("baton-request-button")).toBeNull();
  });

  it("chủ phòng khi holderId === null và chưa có pendingRequests: trả null (AC1)", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-owner",
      myRole: "owner",
      holderId: null,
    });
    const { container } = renderToast("vi");
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("baton-request-bar")).toBeNull();
    expect(screen.queryByTestId("baton-request-button")).toBeNull();
  });

  it("chủ phòng khi holderId === null nhưng có người xin quyền: hiện thông báo Cấp quyền", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-owner",
      myRole: "owner",
      holderId: null,
    });
    useBatonStore.getState().setMemberNames({ "u-owner": "An", "u-b": "Bình" });
    useBatonStore.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-1",
      fromUserId: "u-b",
      sentAt: 100,
    });

    renderToast("vi");
    expect(screen.queryByTestId("baton-request-bar")).toBeNull();
    expect(screen.getByTestId("baton-request-toast").textContent).toContain("Bình");
  });

  it("editor khác giữ Baton: hiện tên người giữ, nút Xin quyền chạy và chuyển sang Đã gửi yêu cầu sau khi bấm", async () => {
    const sendControl = vi.fn();
    useBatonStore.getState().setTransport({ sendControl });
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-b",
      myRole: "editor",
      holderId: "u-a",
    });
    useBatonStore.getState().setMemberNames({ "u-a": "An", "u-b": "Bình" });

    renderToast("vi");
    expect(screen.getByTestId("baton-request-bar").textContent).toContain("An");
    const btn = screen.getByTestId("baton-request-button");
    expect(btn.textContent).toContain("Xin quyền chạy");

    fireEvent.click(btn);
    expect(sendControl).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("baton-request-button").textContent).toContain("Đã gửi yêu cầu");
    });
  });

  it("người giữ Baton thấy danh sách yêu cầu với tên từ store và bấm Cấp quyền chuyển holderId", async () => {
    const sendControl = vi.fn();
    useBatonStore.getState().setTransport({ sendControl });
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-a",
      myRole: "owner",
      holderId: "u-a",
    });
    useBatonStore.getState().setMemberNames({ "u-a": "An", "u-b": "Bình" });
    useBatonStore.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-1",
      fromUserId: "u-b",
      sentAt: 100,
    });

    renderToast("vi");
    expect(screen.getByTestId("baton-request-toast").textContent).toContain("Bình");
    fireEvent.click(screen.getByTestId("baton-grant-button"));

    expect(sendControl).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "baton:grant",
        targetUserId: "u-b",
      }),
    );
    await waitFor(() => {
      expect(useBatonStore.getState().holderId).toBe("u-b");
      expect(useBatonStore.getState().pendingRequests).toEqual([]);
    });
  });

  it("fallback an toàn khi chưa có tên trong memberNames (hỗ trợ cả tiếng Anh)", () => {
    useBatonStore.getState().setRoom({
      projectId: "proj-1",
      myUserId: "u-a",
      myRole: "owner",
      holderId: "u-a",
    });
    useBatonStore.getState().applyControlMessage({
      kind: "baton:request",
      roomId: "proj-1",
      fromUserId: "u-unknown",
      sentAt: 100,
    });

    renderToast("en");
    expect(screen.getByTestId("baton-request-toast").textContent).toContain("Collaborator");
    expect(screen.getByTestId("baton-grant-button").textContent).toContain("Grant");
  });
});
