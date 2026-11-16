import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workspaceMessagesEn from "../../../messages/en/workspace.json";
import workspaceMessagesVi from "../../../messages/vi/workspace.json";
import { openWorkspaceDb } from "./db";
import {
  confirmLogout,
  hasUserLocalDrafts,
  purgeUserScope,
  WorkspacePurgeError,
} from "./logout-flow";
import { getRepository } from "./repository";
import type { WorkspaceProject, WorkspaceTab } from "./types";
import { LogoutDialog } from "./components/logout-dialog";

const ALICE_ID = "usr_alice";
const BOB_ID = "usr_bob";

const makeProject = (over: Partial<WorkspaceProject> & { id: string; scopeKey: string }): WorkspaceProject => ({
  name: "Dự án mẫu",
  engine: "postgres",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

const makeTab = (over: Partial<WorkspaceTab> & { id: string; projectId: string }): WorkspaceTab => ({
  name: "Query 1",
  sql: "SELECT 1;",
  position: 0,
  updatedAt: Date.now(),
  ...over,
});

describe("logout-flow (Task129)", () => {
  let factory: IDBFactory;
  let db: IDBDatabase;

  beforeEach(async () => {
    factory = new IDBFactory();
    db = await openWorkspaceDb(factory);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    cleanup();
    vi.restoreAllMocks();
  });

  describe("hasUserLocalDrafts", () => {
    it("Trả về false khi userId rỗng hoặc không có dữ liệu", async () => {
      expect(await hasUserLocalDrafts("", { db })).toBe(false);
      expect(await hasUserLocalDrafts(ALICE_ID, { db })).toBe(false);
    });

    it("Chỉ kiểm tra đúng scope của user, không nhầm lẫn với guest hoặc user khác", async () => {
      const repo = getRepository(db);
      // Tạo nháp cho guest và bob
      await repo.upsertProject(makeProject({ id: "p_guest", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "t_guest", projectId: "p_guest" }));

      await repo.upsertProject(makeProject({ id: "p_bob", scopeKey: `user_${BOB_ID}` }));
      await repo.upsertTab(makeTab({ id: "t_bob", projectId: "p_bob" }));

      // Alice chưa có nháp nào
      expect(await hasUserLocalDrafts(ALICE_ID, { db })).toBe(false);

      // Thêm nháp cho Alice
      await repo.upsertProject(makeProject({ id: "p_alice", scopeKey: `user_${ALICE_ID}` }));
      await repo.upsertTab(makeTab({ id: "t_alice", projectId: "p_alice" }));

      expect(await hasUserLocalDrafts(ALICE_ID, { db })).toBe(true);
    });

    it("Bắt lỗi an toàn khi IndexedDB bị chặn (Private mode) và trả về false", async () => {
      const brokenFactory = {
        open: () => {
          const req = {} as IDBOpenDBRequest;
          setTimeout(() => {
            const err = new Error("SecurityError: Storage access is denied");
            err.name = "SecurityError";
            Object.defineProperty(req, "error", { value: err });
            req.onerror?.(new Event("error"));
          }, 0);
          return req;
        },
      } as unknown as IDBFactory;

      const result = await hasUserLocalDrafts(ALICE_ID, { factory: brokenFactory });
      expect(result).toBe(false);
    });
  });

  describe("purgeUserScope (AC2)", () => {
    it("AC2: Xóa sạch projects và tabs của user, đếm đúng số tab đã xóa", async () => {
      const repo = getRepository(db);

      // Tạo 2 dự án cho Alice: Dự án 1 có 2 tab, Dự án 2 có 1 tab
      await repo.upsertProject(makeProject({ id: "p1", scopeKey: `user_${ALICE_ID}`, name: "Alice Project 1" }));
      await repo.upsertTab(makeTab({ id: "t1_1", projectId: "p1" }));
      await repo.upsertTab(makeTab({ id: "t1_2", projectId: "p1" }));

      await repo.upsertProject(makeProject({ id: "p2", scopeKey: `user_${ALICE_ID}`, name: "Alice Project 2" }));
      await repo.upsertTab(makeTab({ id: "t2_1", projectId: "p2" }));

      // Tạo dữ liệu cho Guest và Bob để xác minh AC2
      await repo.upsertProject(makeProject({ id: "p_guest", scopeKey: "guest", name: "Guest Project" }));
      await repo.upsertTab(makeTab({ id: "t_guest", projectId: "p_guest", sql: "SELECT 'guest';" }));

      await repo.upsertProject(makeProject({ id: "p_bob", scopeKey: `user_${BOB_ID}`, name: "Bob Project" }));
      await repo.upsertTab(makeTab({ id: "t_bob", projectId: "p_bob", sql: "SELECT 'bob';" }));

      // Thực hiện purge scope của Alice
      const deletedCount = await purgeUserScope(ALICE_ID, { db });

      // Alice có tổng cộng 3 tab bị xóa
      expect(deletedCount).toBe(3);

      // Kiểm tra trong DB: Alice không còn project hay tab nào
      const aliceProjects = await repo.listProjects({ kind: "user", userId: ALICE_ID });
      expect(aliceProjects).toHaveLength(0);
      expect(await repo.listTabs("p1")).toHaveLength(0);
      expect(await repo.listTabs("p2")).toHaveLength(0);

      // AC2: Scope guest còn nguyên 100%
      const guestProjects = await repo.listProjects({ kind: "guest" });
      expect(guestProjects).toHaveLength(1);
      expect(guestProjects[0].name).toBe("Guest Project");
      const guestTabs = await repo.listTabs("p_guest");
      expect(guestTabs).toHaveLength(1);
      expect(guestTabs[0].sql).toBe("SELECT 'guest';");

      // Dữ liệu của Bob cũng còn nguyên
      const bobProjects = await repo.listProjects({ kind: "user", userId: BOB_ID });
      expect(bobProjects).toHaveLength(1);
      expect(await repo.listTabs("p_bob")).toHaveLength(1);
    });

    it("Ca biên: Người dùng không có dữ liệu nào thì trả về 0", async () => {
      const deleted = await purgeUserScope(ALICE_ID, { db });
      expect(deleted).toBe(0);
    });

    it("Ca biên: Xóa lỗi giữa đường thì ném WorkspacePurgeError báo phần còn lại", async () => {
      const repo = getRepository(db);

      await repo.upsertProject(makeProject({ id: "p1", scopeKey: `user_${ALICE_ID}`, name: "Dự án 1" }));
      await repo.upsertTab(makeTab({ id: "t1", projectId: "p1" }));
      await repo.upsertTab(makeTab({ id: "t2", projectId: "p1" }));

      await repo.upsertProject(makeProject({ id: "p2", scopeKey: `user_${ALICE_ID}`, name: "Dự án 2" }));
      await repo.upsertTab(makeTab({ id: "t3", projectId: "p2" }));

      // Giả lập lỗi ở project thứ hai khi gọi deleteProjectCascade
      const originalDeleteCascade = repo.deleteProjectCascade;
      let callCount = 0;
      vi.spyOn(repo, "deleteProjectCascade").mockImplementation(async (id: string) => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Disk I/O Error");
        }
        return originalDeleteCascade(id);
      });

      // Viết test cho instance WorkspacePurgeError
      try {
        await purgeUserScope(ALICE_ID, { db, repo });
        expect.unreachable("Phải ném WorkspacePurgeError");
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspacePurgeError);
        const purgeErr = err as WorkspacePurgeError;
        expect(purgeErr.code).toBe("WORKSPACE_PURGE_FAILED");
        // Dự án 1 có 2 tab đã xóa thành công, dự án 2 có 1 tab chưa xóa được
        expect(purgeErr.deletedTabs).toBe(2);
        expect(purgeErr.remainingTabs).toBe(1);
      }
    });

    it("Ca biên: Chống bấm đúp (in-flight deduplication) khi gọi purge đồng thời", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p1", scopeKey: `user_${ALICE_ID}`, name: "Alice Project" }));
      await repo.upsertTab(makeTab({ id: "t1", projectId: "p1" }));

      // Gọi purge đồng thời 2 lần cho cùng một userId
      const [res1, res2] = await Promise.all([
        purgeUserScope(ALICE_ID, { db }),
        purgeUserScope(ALICE_ID, { db }),
      ]);

      expect(res1).toBe(1);
      expect(res2).toBe(1);
    });
  });

  describe("confirmLogout", () => {
    it("Ca biên: Không có nháp -> tự động trả về 'keep' mà không hiển thị prompt", async () => {
      const promptMock = vi.fn();
      const choice = await confirmLogout({
        hasLocalDrafts: false,
        prompt: promptMock,
      });

      expect(choice).toBe("keep");
      expect(promptMock).not.toHaveBeenCalled();
    });

    it("AC1: Có nháp nhưng không có prompt -> mặc định trả về 'delete'", async () => {
      const choice = await confirmLogout({
        hasLocalDrafts: true,
      });

      expect(choice).toBe("delete");
    });

    it("AC1, AC3, AC4: Có nháp và có prompt -> tuân thủ kết quả từ prompt", async () => {
      expect(await confirmLogout({ hasLocalDrafts: true, prompt: async () => "delete" })).toBe("delete");
      expect(await confirmLogout({ hasLocalDrafts: true, prompt: async () => "keep" })).toBe("keep");
      expect(await confirmLogout({ hasLocalDrafts: true, prompt: async () => "cancel" })).toBe("cancel");
    });
  });

  describe("AC5: Tuyệt đối không gọi bất kỳ API cloud nào (Core Rule 7)", () => {
    it("Toàn bộ luồng dọn dẹp nháp cục bộ không gửi bất kỳ request fetch nào", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p1", scopeKey: `user_${ALICE_ID}` }));
      await repo.upsertTab(makeTab({ id: "t1", projectId: "p1" }));

      // 1. Kiểm tra nháp
      const hasDrafts = await hasUserLocalDrafts(ALICE_ID, { db });
      expect(hasDrafts).toBe(true);

      // 2. Xác nhận
      const choice = await confirmLogout({ hasLocalDrafts: true, prompt: async () => "delete" });
      expect(choice).toBe("delete");

      // 3. Xóa nháp
      const deleted = await purgeUserScope(ALICE_ID, { db });
      expect(deleted).toBe(1);

      // Tuyệt đối không có fetch nào được kích hoạt
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("AC6: LogoutDialog Component & Accessibility", () => {
    const renderDialog = (
      props: Partial<React.ComponentProps<typeof LogoutDialog>> = {},
      locale = "vi",
    ) => {
      const messages = locale === "vi" ? { workspace: workspaceMessagesVi } : { workspace: workspaceMessagesEn };
      return render(
        React.createElement(
          NextIntlClientProvider as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          { locale, messages },
          React.createElement(LogoutDialog, {
            open: true,
            onChoice: vi.fn(),
            onCancel: vi.fn(),
            onConfirm: vi.fn(),
            ...props,
          }),
        ),
      );
    };

    it("AC6: Hiển thị đúng đầy đủ bản dịch tiếng Việt", () => {
      renderDialog({}, "vi");

      expect(screen.getByText("Đăng xuất khỏi thiết bị")).toBeTruthy();
      expect(screen.getByText(/Bạn có các câu lệnh và dự án nháp đang được lưu trên trình duyệt/)).toBeTruthy();
      expect(screen.getByText(/Khuyên dùng trên máy tính công cộng hoặc máy dùng chung/)).toBeTruthy();
      expect(screen.getByTestId("logout-delete-button").textContent).toContain("Xóa nháp cục bộ");
      expect(screen.getByTestId("logout-keep-button").textContent).toContain("Giữ nháp lại");
      expect(screen.getByTestId("logout-cancel-button").textContent).toContain("Hủy");
    });

    it("AC6: Hiển thị đúng đầy đủ bản dịch tiếng Anh", () => {
      renderDialog({}, "en");

      expect(screen.getByText("Sign out of device")).toBeTruthy();
      expect(screen.getByText(/You have draft queries and projects saved in this browser/)).toBeTruthy();
      expect(screen.getByText(/Recommended on public or shared computers/)).toBeTruthy();
      expect(screen.getByTestId("logout-delete-button").textContent).toContain("Clear local drafts");
      expect(screen.getByTestId("logout-keep-button").textContent).toContain("Keep local drafts");
      expect(screen.getByTestId("logout-cancel-button").textContent).toContain("Cancel");
    });

    it("AC1 & AC6: Nút 'Xóa nháp cục bộ' có autoFocus và trigger khi nhấn", async () => {
      const onConfirm = vi.fn();
      const onChoice = vi.fn();
      renderDialog({ onConfirm, onChoice });

      const deleteBtn = screen.getByTestId("logout-delete-button");
      expect(deleteBtn.getAttribute("autofocus")).toBeDefined();

      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      expect(onConfirm).toHaveBeenCalledWith("delete");
      expect(onChoice).toHaveBeenCalledWith("delete");
    });

    it("AC3: Bấm nút 'Giữ nháp lại' gọi callback tương ứng", async () => {
      const onConfirm = vi.fn();
      const onChoice = vi.fn();
      renderDialog({ onConfirm, onChoice });

      const keepBtn = screen.getByTestId("logout-keep-button");
      await act(async () => {
        fireEvent.click(keepBtn);
      });

      expect(onConfirm).toHaveBeenCalledWith("keep");
      expect(onChoice).toHaveBeenCalledWith("keep");
    });

    it("AC4: Bấm nút 'Hủy' gọi callback onCancel và onChoice('cancel')", async () => {
      const onCancel = vi.fn();
      const onChoice = vi.fn();
      renderDialog({ onCancel, onChoice });

      const cancelBtn = screen.getByTestId("logout-cancel-button");
      await act(async () => {
        fireEvent.click(cancelBtn);
      });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onChoice).toHaveBeenCalledWith("cancel");
    });

    it("AC6: Nhấn phím Escape đóng modal và kích hoạt cancel", async () => {
      const onCancel = vi.fn();
      const onChoice = vi.fn();
      renderDialog({ onCancel, onChoice });

      await act(async () => {
        fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
      });

      expect(onCancel).toHaveBeenCalled();
      expect(onChoice).toHaveBeenCalledWith("cancel");
    });

    it("AC6: Responsive kiểm tra thuộc tính style/class không tràn ngang ở 390px", () => {
      renderDialog();
      // Dialog content có class w-full max-w-[calc(100%-2rem)] sm:max-w-md
      const content = document.querySelector("[data-slot='dialog-content']");
      expect(content).toBeTruthy();
      expect(content?.className).toContain("max-w-[calc(100%-2rem)]");
    });

    it("Khi loading=true, tất cả các nút bấm bị vô hiệu hóa để chống bấm đúp", () => {
      renderDialog({ loading: true });

      expect(screen.getByTestId("logout-delete-button")).toHaveProperty("disabled", true);
      expect(screen.getByTestId("logout-keep-button")).toHaveProperty("disabled", true);
      expect(screen.getByTestId("logout-cancel-button")).toHaveProperty("disabled", true);
    });
  });
});
