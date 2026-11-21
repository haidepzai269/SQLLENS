// Test giao diện panel Cloud (Task154). Không mock IndexedDB và không mock store: chỉ mock đúng
// ba chỗ đi ra khỏi giao diện (pushProject/detachCloudLink, pullIntoProject, deleteCloudProject)
// và phiên đăng nhập.

import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/cloud.json";
import messagesVi from "../../../../messages/vi/cloud.json";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceCloudLink, WorkspaceProject, WorkspaceTab } from "@/modules/workspace/types";
import { CloudSyncError } from "../sync";
import { projectStamp, projectTabs } from "../status";
import { CloudPanel } from "./cloud-panel";

let authStatus: "loading" | "anon" | "user" | "unavailable" = "user";

vi.mock("@/modules/auth/auth-provider", () => ({
  useAuth: () => ({ status: authStatus }),
}));

vi.mock("@/modules/auth/guest", () => ({
  // `guest.tsx` có test riêng cho việc dựng link /login; ở đây chỉ cần biết panel có mời đăng nhập.
  SignInLink: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className} data-testid="sign-in-link" data-href="/login">
      {children}
    </button>
  ),
}));

vi.mock("../sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync")>();
  return {
    ...actual,
    pushProject: vi.fn(),
    detachCloudLink: vi.fn(),
  };
});

vi.mock("../apply", () => ({ pullIntoProject: vi.fn() }));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, deleteCloudProject: vi.fn() };
});

import { CloudApiError, deleteCloudProject } from "../api";
import { pullIntoProject } from "../apply";
import { detachCloudLink, pushProject } from "../sync";

const pushMock = vi.mocked(pushProject);
const pullMock = vi.mocked(pullIntoProject);
const detachMock = vi.mocked(detachCloudLink);
const deleteMock = vi.mocked(deleteCloudProject);

const REMOTE_AT = "2026-11-21T10:00:00Z";

afterEach(cleanup);

function seed(cloud?: WorkspaceCloudLink) {
  const store = useWorkspaceStore.getState();
  const project = store.createProject({ name: "Alpha", engine: "postgres" });
  store.createTab(project.id);
  if (cloud) store.setProjectCloud(project.id, cloud);
  return project.id;
}

function current(): WorkspaceProject {
  const state = useWorkspaceStore.getState();
  const project = state.projects[0];
  if (!project) throw new Error("thiếu dự án");
  return project;
}

function tabsOf(projectId: string): WorkspaceTab[] {
  return projectTabs(useWorkspaceStore.getState().tabs, projectId);
}

/** Liên kết cloud khớp đúng nội dung hiện tại → trạng thái `synced`. */
function syncedLink(projectId: string): WorkspaceCloudLink {
  const project = current();
  return {
    remoteId: "remote-1",
    remoteUpdatedAt: REMOTE_AT,
    stamp: projectStamp(project, tabsOf(projectId)),
  };
}

function renderPanel(projectId: string, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ cloud: locale === "vi" ? messagesVi : messagesEn }}>
      <CloudPanel projectId={projectId} />
    </NextIntlClientProvider>,
  );
}

function status(): string {
  return screen.getByTestId("cloud-panel").getAttribute("data-state") ?? "";
}

beforeEach(() => {
  useWorkspaceStore.getState().reset();
  authStatus = "user";
  vi.clearAllMocks();
  detachMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

describe("CloudPanel — bốn trạng thái (AC1, AC2)", () => {
  it("AC1: dự án chưa lưu hiện `local`; lưu xong hiện `synced` kèm thời gian", async () => {
    const projectId = seed();
    pushMock.mockResolvedValue({
      kind: "ok",
      updatedAt: REMOTE_AT,
      remoteId: "remote-1",
      stamp: projectStamp(current(), tabsOf(projectId)),
    });

    renderPanel(projectId);
    expect(status()).toBe("local");
    expect(screen.getByText(messagesVi.status.local)).toBeTruthy();

    fireEvent.click(screen.getByTestId("cloud-save"));

    await waitFor(() => expect(status()).toBe("synced"));
    expect(screen.getByText(messagesVi.status.synced)).toBeTruthy();
    expect(screen.getByTestId("cloud-saved-at").textContent).toContain(
      messagesVi.savedAt.replace("{time}", "").trim(),
    );
    // Liên kết đã ghi vào store để lần đẩy sau là PUT, không phải POST lần nữa.
    expect(current().cloud?.remoteId).toBe("remote-1");
  });

  it("AC2: sửa SQL sau khi lưu thì hiện `modified` và không tự đẩy", async () => {
    const projectId = seed();
    useWorkspaceStore.getState().setProjectCloud(projectId, syncedLink(projectId));

    renderPanel(projectId);
    expect(status()).toBe("synced");
    expect(pushMock).not.toHaveBeenCalled();

    const tab = tabsOf(projectId)[0];
    useWorkspaceStore.getState().updateTabSql(tab.id, "SELECT 42");

    await waitFor(() => expect(status()).toBe("modified"));
    // Không có timer hay tự đồng bộ: vẫn 0 lần gọi mạng sau khi sửa.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("đổi tên tab cũng tính là thay đổi chưa lưu", async () => {
    const projectId = seed();
    useWorkspaceStore.getState().setProjectCloud(projectId, syncedLink(projectId));
    renderPanel(projectId);
    expect(status()).toBe("synced");

    useWorkspaceStore.getState().renameTab(tabsOf(projectId)[0].id, "khác.sql");
    await waitFor(() => expect(status()).toBe("modified"));
  });
});

describe("CloudPanel — xung đột (AC3)", () => {
  it("hiện hai lựa chọn, không tự chọn, và không ghi gì khi chưa bấm", async () => {
    const projectId = seed();
    const link = syncedLink(projectId);
    useWorkspaceStore.getState().setProjectCloud(projectId, link);
    pushMock.mockResolvedValue({
      kind: "conflict",
      remoteUpdatedAt: "2026-11-21T11:00:00Z",
      localUpdatedAt: Date.now(),
    });

    renderPanel(projectId);
    fireEvent.click(screen.getByTestId("cloud-save"));

    await screen.findByTestId("cloud-conflict");
    expect(screen.getByTestId("cloud-conflict-keep")).toBeTruthy();
    expect(screen.getByTestId("cloud-conflict-take")).toBeTruthy();
    // Chưa bấm gì: liên kết cũ và tab giữ nguyên.
    expect(current().cloud?.remoteId).toBe(link.remoteId);
    expect(status()).toBe("conflict");
  });

  it("giữ bản máy: đóng hộp thoại, chuyển sang `modified`, không gọi thêm mạng", async () => {
    const projectId = seed();
    useWorkspaceStore.getState().setProjectCloud(projectId, syncedLink(projectId));
    pushMock.mockResolvedValue({ kind: "conflict", remoteUpdatedAt: REMOTE_AT, localUpdatedAt: 1 });

    renderPanel(projectId);
    fireEvent.click(screen.getByTestId("cloud-save"));
    await screen.findByTestId("cloud-conflict");
    fireEvent.click(screen.getByTestId("cloud-conflict-keep"));

    expect(screen.queryByTestId("cloud-conflict")).toBeNull();
    expect(status()).toBe("modified");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pullMock).not.toHaveBeenCalled();
  });

  it("lấy bản cloud: thay nội dung đang mở bằng bản vừa kéo, không tạo dự án mới", async () => {
    const projectId = seed();
    useWorkspaceStore.getState().setProjectCloud(projectId, syncedLink(projectId));
    pushMock.mockResolvedValue({ kind: "conflict", remoteUpdatedAt: REMOTE_AT, localUpdatedAt: 1 });

    const pulledTab: WorkspaceTab = {
      id: "new-tab",
      projectId,
      name: "cloud.sql",
      sql: "SELECT 'cloud'",
      position: 0,
      updatedAt: 5,
    };
    const pulledProject: WorkspaceProject = {
      ...current(),
      name: "Bản cloud",
      cloud: { remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" },
    };
    pullMock.mockResolvedValue({ project: pulledProject, tabs: [pulledTab] });

    renderPanel(projectId);
    fireEvent.click(screen.getByTestId("cloud-save"));
    await screen.findByTestId("cloud-conflict");
    fireEvent.click(screen.getByTestId("cloud-conflict-take"));

    await waitFor(() => expect(pullMock).toHaveBeenCalledWith(projectId));
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().projects[0].name).toBe("Bản cloud");
    expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(["new-tab"]);
    expect(useWorkspaceStore.getState().activeTabId).toBe("new-tab");
    expect(screen.getByTestId("cloud-notice").textContent).toContain(messagesVi.pullDone);
  });
});

describe("CloudPanel — xóa trên cloud (AC4)", () => {
  it("cần xác nhận hai bước; xong thì dự án local vẫn còn và về `local`", async () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-delete"));
    expect(screen.getByTestId("cloud-delete-confirm")).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("cloud-delete-confirm-action"));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("remote-1"));
    await waitFor(() => expect(status()).toBe("local"));
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(current().cloud).toBeUndefined();
    expect(screen.getByTestId("cloud-notice").textContent).toContain(messagesVi.deleteDone);
  });

  it("hủy ở bước xác nhận thì không gọi mạng", () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-delete"));
    fireEvent.click(screen.getByTestId("cloud-delete-cancel"));

    expect(screen.queryByTestId("cloud-delete-confirm")).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(current().cloud?.remoteId).toBe("remote-1");
  });

  it("404 khi xóa nghĩa là đã xóa rồi: vẫn dọn liên kết, không báo lỗi", async () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    deleteMock.mockRejectedValue(new CloudApiError(404, "not_found", "không có"));
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-delete"));
    fireEvent.click(screen.getByTestId("cloud-delete-confirm-action"));

    await waitFor(() => expect(status()).toBe("local"));
    expect(current().cloud).toBeUndefined();
    expect(screen.queryByTestId("cloud-error")).toBeNull();
  });
});

describe("CloudPanel — khách chưa đăng nhập (AC5)", () => {
  it("thấy lời mời đăng nhập, không thấy nút lưu", () => {
    const projectId = seed();
    authStatus = "anon";
    renderPanel(projectId);

    expect(screen.getByTestId("cloud-need-login").textContent).toContain(messagesVi.needLogin);
    expect(screen.getByTestId("sign-in-link").getAttribute("data-href")).toBe("/login");
    expect(screen.queryByTestId("cloud-save")).toBeNull();
    expect(screen.queryByTestId("cloud-pull")).toBeNull();
    expect(screen.queryByTestId("cloud-delete")).toBeNull();
  });
});

describe("CloudPanel — lỗi và bản trên cloud đã bị xóa", () => {
  it("lỗi dữ liệu hiện đúng mã cụ thể của server, nêu việc cần làm", async () => {
    const projectId = seed();
    pushMock.mockRejectedValue(
      new CloudSyncError("REJECTED", "từ chối", undefined, "too_many_tabs"),
    );
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-save"));

    await screen.findByTestId("cloud-error");
    expect(screen.getByTestId("cloud-error").textContent).toContain(messagesVi.rejected.too_many_tabs);
    // Không ghi liên kết giả khi lưu hỏng.
    expect(current().cloud).toBeUndefined();
    expect(status()).toBe("local");
  });

  it("hết phiên đăng nhập giữa lúc lưu: báo hết hạn, không phải lỗi mạng", async () => {
    const projectId = seed();
    pushMock.mockRejectedValue(new CloudSyncError("AUTH_REQUIRED", "hết hạn"));
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-save"));

    await screen.findByTestId("cloud-error");
    expect(screen.getByTestId("cloud-error").textContent).toContain(messagesVi.error.AUTH_REQUIRED);
  });

  it("remote_gone: hai lối thoát — đẩy thành dự án mới hoặc gỡ liên kết", async () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    pushMock.mockResolvedValue({ kind: "remote_gone", remoteId: "remote-1" });
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-save"));
    await screen.findByTestId("cloud-remote-gone");
    expect(screen.getByTestId("cloud-remote-gone").textContent).toContain(messagesVi.remoteGone);

    pushMock.mockResolvedValue({
      kind: "ok",
      updatedAt: REMOTE_AT,
      remoteId: "remote-2",
      stamp: "y",
    });
    fireEvent.click(screen.getByTestId("cloud-remote-gone-save-new"));
    await waitFor(() => expect(current().cloud?.remoteId).toBe("remote-2"));
    expect(pushMock).toHaveBeenLastCalledWith(projectId, { asNew: true });
    expect(screen.queryByTestId("cloud-remote-gone")).toBeNull();
  });

  it("gỡ liên kết cloud để dự án chỉ còn trên máy", async () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    pushMock.mockResolvedValue({ kind: "remote_gone", remoteId: "remote-1" });
    renderPanel(projectId);

    fireEvent.click(screen.getByTestId("cloud-save"));
    await screen.findByTestId("cloud-remote-gone");
    fireEvent.click(screen.getByTestId("cloud-remote-gone-detach"));

    await waitFor(() => expect(detachMock).toHaveBeenCalledWith(projectId));
    await waitFor(() => expect(status()).toBe("local"));
    expect(current().cloud).toBeUndefined();
    expect(screen.getByTestId("cloud-notice").textContent).toContain(messagesVi.remoteGoneDetached);
  });
});

describe("CloudPanel — song ngữ, bàn phím, rào chắn (AC6)", () => {
  it("tiếng Anh dùng đúng chuỗi en", () => {
    const projectId = seed();
    renderPanel(projectId, "en");

    expect(screen.getByTestId("cloud-status").textContent).toBe(messagesEn.status.local);
    expect(screen.getByTestId("cloud-save").textContent).toContain(messagesEn.save);
  });

  it("mọi hành động là nút thật, bấm được bằng bàn phím, và bị khóa khi đang bận", async () => {
    const projectId = seed({ remoteId: "remote-1", remoteUpdatedAt: REMOTE_AT, stamp: "x" });
    let release: (value: Awaited<ReturnType<typeof pushProject>>) => void = () => {};
    pushMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderPanel(projectId);

    const save = screen.getByTestId("cloud-save") as HTMLButtonElement;
    expect(save.tagName).toBe("BUTTON");
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    // Đang lưu: mọi nút khóa, có aria-busy, và nút lưu đổi sang chuỗi "đang lưu".
    await waitFor(() => expect(save.textContent).toContain(messagesVi.saving));
    expect(save.disabled).toBe(true);
    expect((screen.getByTestId("cloud-delete") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cloud-panel").getAttribute("aria-busy")).toBe("true");

    release({ kind: "ok", updatedAt: REMOTE_AT, remoteId: "remote-1", stamp: "x" });
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it("panel không có timer và không tự gọi mạng khi mount", () => {
    const source = readFileSync("src/modules/cloud/components/cloud-panel.tsx", "utf8");
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/useEffect/);

    const projectId = seed();
    renderPanel(projectId);
    expect(pushMock).not.toHaveBeenCalled();
    expect(pullMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
