import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";
import { useWorkspaceStore } from "./store";
import type { WorkspaceTab } from "./types";

describe("Workspace Autosave & Store (Task123)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("createAutosave (Debounce & Flush)", () => {
    it("cancel(key) bỏ phần đang chờ, không ghi đè bản ghi vừa xóa", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({ save: saveMock, delayMs: 300 });

      autosave.schedule("tab-1", "SELECT 'vua dong';");
      autosave.schedule("tab-2", "SELECT 'con mo';");
      autosave.cancel("tab-1");

      await vi.advanceTimersByTimeAsync(400);

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith("tab-2", "SELECT 'con mo';");
      expect(autosave.isPending()).toBe(false);
    });

    it("AC1: Gọi schedule 5 lần trong 200ms cho cùng một key chỉ ghi đúng 1 lần với payload cuối", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      // 5 lần gọi trong vòng 200ms
      autosave.schedule("tab-1", "SELECT 1;");
      vi.advanceTimersByTime(40);
      autosave.schedule("tab-1", "SELECT 12;");
      vi.advanceTimersByTime(40);
      autosave.schedule("tab-1", "SELECT 123;");
      vi.advanceTimersByTime(40);
      autosave.schedule("tab-1", "SELECT 1234;");
      vi.advanceTimersByTime(40);
      autosave.schedule("tab-1", "SELECT 12345;");

      // Tại thời điểm 200ms (sau 4 lần advance 40ms, tức 160ms từ lần đầu): chưa quá 300ms từ lần gọi cuối
      expect(saveMock).not.toHaveBeenCalled();

      // Tiến thêm 299ms kể từ lần schedule cuối cùng: vẫn chưa gọi
      vi.advanceTimersByTime(299);
      expect(saveMock).not.toHaveBeenCalled();

      // Tiến thêm 1ms nữa (đủ 300ms kể từ lần schedule cuối)
      vi.advanceTimersByTime(1);
      await Promise.resolve();

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith("tab-1", "SELECT 12345;");

      await autosave.dispose();
    });

    it("AC1 (độc lập key): hai key khác nhau debounce riêng rẽ không đè lên nhau", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      autosave.schedule("key-a", "payload-a1");
      vi.advanceTimersByTime(100);
      autosave.schedule("key-b", "payload-b1");

      // Tại 300ms: key-a kích hoạt
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith("key-a", "payload-a1");

      // Tại 400ms: key-b kích hoạt
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(saveMock).toHaveBeenCalledWith("key-b", "payload-b1");

      await autosave.dispose();
    });

    it("AC2: flush() ghi ngay phần đang chờ và trả về sau khi ghi xong", async () => {
      let isSaving = false;
      const saveMock = vi.fn().mockImplementation(async () => {
        isSaving = true;
        // Giả lập tác vụ async
        await Promise.resolve();
        isSaving = false;
      });

      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      autosave.schedule("tab-1", "SELECT * FROM users;");
      expect(saveMock).not.toHaveBeenCalled();

      // Gọi flush ngay lập tức mà không chờ hết timer
      const flushPromise = autosave.flush();
      expect(saveMock).toHaveBeenCalledWith("tab-1", "SELECT * FROM users;");

      await flushPromise;
      expect(isSaving).toBe(false);

      // Tiến thời gian 1000ms: không có lần gọi thừa nào từ timer cũ
      vi.advanceTimersByTime(1000);
      expect(saveMock).toHaveBeenCalledTimes(1);

      await autosave.dispose();
    });

    it("AC2: dispose() hủy timer, flush nốt dữ liệu đang chờ, và gỡ listener", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      expect(addSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));

      autosave.schedule("tab-flush", "PENDING_SQL");
      expect(saveMock).not.toHaveBeenCalled();

      await autosave.dispose();

      // Đã flush nốt
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith("tab-flush", "PENDING_SQL");

      // Đã gỡ listener
      expect(removeSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));

      // Lần schedule sau dispose bị bỏ qua
      autosave.schedule("tab-after", "IGNORED_SQL");
      vi.advanceTimersByTime(500);
      expect(saveMock).toHaveBeenCalledTimes(1);

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("Ca biên: dispose() gọi hai lần không sinh lỗi và không làm lại", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      autosave.schedule("k1", "v1");

      await autosave.dispose();
      expect(saveMock).toHaveBeenCalledTimes(1);

      // Gọi lần 2: an toàn tuyệt đối
      await expect(autosave.dispose()).resolves.toBeUndefined();
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("Ca biên: flush() khi không có gì chờ giải quyết ngay lập tức", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      expect(autosave.isPending()).toBe(false);
      await expect(autosave.flush()).resolves.toBeUndefined();
      expect(saveMock).not.toHaveBeenCalled();

      await autosave.dispose();
    });

    it("Sự kiện pagehide trên window tự động kích hoạt flush", async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const autosave = createAutosave<string>({
        save: saveMock,
        delayMs: 300,
      });

      autosave.schedule("tab-hide", "SQL_BEFORE_HIDE");
      expect(saveMock).not.toHaveBeenCalled();

      // Giả lập sự kiện pagehide của trình duyệt
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();

      expect(saveMock).toHaveBeenCalledWith("tab-hide", "SQL_BEFORE_HIDE");
      await autosave.dispose();
    });
  });

  describe("useWorkspaceStore & AC3: Xử lý lỗi lưu trữ & Bảo toàn RAM", () => {
    it("AC3: Ghi lỗi thì saveState = 'error' kèm thông điệp, dữ liệu trong RAM không bị mất, lần sửa kế tiếp vẫn thử ghi lại", async () => {
      let shouldFail = true;
      const errorMsg = "IndexedDB QuotaExceededError: Bộ nhớ trình duyệt đã đầy";

      const store = useWorkspaceStore.getState();
      const project = store.createProject({ name: "Demo Project", engine: "postgres" });
      const tab = store.createTab(project.id, "Query 1.sql");

      const saveMock = vi.fn().mockImplementation(async () => {
        useWorkspaceStore.getState().setSaveState("saving");
        if (shouldFail) {
          useWorkspaceStore.getState().setSaveState("error", errorMsg);
          throw new Error(errorMsg);
        }
        useWorkspaceStore.getState().setSaveState("idle");
      });

      const autosave = createAutosave<WorkspaceTab>({
        save: saveMock,
        delayMs: 300,
      });

      // Lần 1: Người dùng gõ câu lệnh SQL
      const testSql = "SELECT * FROM large_table;";
      useWorkspaceStore.getState().updateTabSql(tab.id, testSql);

      const tabFromStore = useWorkspaceStore.getState().tabs.find((t) => t.id === tab.id)!;
      autosave.schedule(tab.id, tabFromStore);

      // Kích hoạt timer
      vi.advanceTimersByTime(300);
      await Promise.resolve();

      // Kiểm tra trạng thái lỗi
      const stateAfterError = useWorkspaceStore.getState();
      expect(stateAfterError.saveState).toBe("error");
      expect(stateAfterError.saveError).toBe(errorMsg);

      // Dữ liệu trong RAM KHÔNG bị mất!
      const currentTab = stateAfterError.tabs.find((t) => t.id === tab.id);
      expect(currentTab?.sql).toBe(testSql);

      // Lần 2: Người dùng sửa tiếp, lần này DB ghi thành công
      shouldFail = false;
      const nextSql = "SELECT 1;";
      useWorkspaceStore.getState().updateTabSql(tab.id, nextSql);

      const nextTab = useWorkspaceStore.getState().tabs.find((t) => t.id === tab.id)!;
      autosave.schedule(tab.id, nextTab);

      vi.advanceTimersByTime(300);
      await Promise.resolve();

      // Đã ghi lại thành công, saveState về idle
      const stateAfterSuccess = useWorkspaceStore.getState();
      expect(stateAfterSuccess.saveState).toBe("idle");
      expect(stateAfterSuccess.saveError).toBeNull();
      expect(stateAfterSuccess.tabs.find((t) => t.id === tab.id)?.sql).toBe(nextSql);
      expect(saveMock).toHaveBeenCalledTimes(2);

      await autosave.dispose();
    });
  });

  describe("useWorkspaceStore (Quản lý Projects & Tabs)", () => {
    it("Khởi tạo và hydrate chuẩn xác", () => {
      const store = useWorkspaceStore.getState();
      expect(store.scope).toEqual({ kind: "guest" });
      expect(store.projects).toEqual([]);
      expect(store.tabs).toEqual([]);
      expect(store.activeProjectId).toBeNull();
      expect(store.activeTabId).toBeNull();
      expect(store.saveState).toBe("idle");

      // Hydrate
      store.hydrate({
        projects: [
          {
            id: "p1",
            scopeKey: "guest",
            name: "P1",
            engine: "postgres",
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        tabs: [
          {
            id: "t1",
            projectId: "p1",
            name: "Query.sql",
            sql: "SELECT 1;",
            position: 0,
            updatedAt: 100,
          },
        ],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      const hydrated = useWorkspaceStore.getState();
      expect(hydrated.projects).toHaveLength(1);
      expect(hydrated.tabs).toHaveLength(1);
      expect(hydrated.activeProjectId).toBe("p1");
      expect(hydrated.activeTabId).toBe("t1");
    });

    it("Tạo, đổi tên và xóa project dọn dẹp tabs", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "Project Alpha", engine: "mysql" });
      expect(p1.id).toBeDefined();
      expect(p1.name).toBe("Project Alpha");
      expect(p1.engine).toBe("mysql");
      expect(useWorkspaceStore.getState().activeProjectId).toBe(p1.id);

      // Đổi tên
      store.renameProject(p1.id, "Project Alpha Renamed");
      expect(useWorkspaceStore.getState().projects[0].name).toBe("Project Alpha Renamed");

      // Tạo tabs cho p1
      store.createTab(p1.id, "Tab 1");
      store.createTab(p1.id, "Tab 2");
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);

      // Tạo thêm project p2
      const p2 = store.createProject({ name: "Project Beta", engine: "postgres" });
      expect(useWorkspaceStore.getState().activeProjectId).toBe(p2.id);

      // Xóa p2: activeProjectId chuyển về p1
      store.deleteProject(p2.id);
      expect(useWorkspaceStore.getState().activeProjectId).toBe(p1.id);

      // Xóa p1: dọn sạch cả tabs của p1, active chuyển về null
      store.deleteProject(p1.id);
      expect(useWorkspaceStore.getState().projects).toHaveLength(0);
      expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
      expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
      expect(useWorkspaceStore.getState().activeTabId).toBeNull();
    });

    it("AC4: closeTab khi còn 1 tab không xóa tab cuối", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Single Tab Test", engine: "postgres" });
      const t = store.createTab(p.id, "Only Tab");

      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);

      // Gọi closeTab khi chỉ có 1 tab
      store.closeTab(t.id);

      // Tab vẫn còn nguyên vẹn, không bị xóa
      const state = useWorkspaceStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe(t.id);
      expect(state.activeTabId).toBe(t.id);
    });

    it("AC4: closeTab tab đang mở ở giữa chọn tab kế bên sau nó", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Multi Tab Test", engine: "postgres" });
      const t1 = store.createTab(p.id, "Tab 1");
      const t2 = store.createTab(p.id, "Tab 2");
      const t3 = store.createTab(p.id, "Tab 3");

      // Active tab 2 (ở giữa)
      useWorkspaceStore.setState({ activeTabId: t2.id });

      store.closeTab(t2.id);

      const state = useWorkspaceStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.tabs.some((tab) => tab.id === t2.id)).toBe(false);
      // Chọn tab kế bên sau nó là t3
      expect(state.activeTabId).toBe(t3.id);

      // Đóng tab đầu tiên (t1): tab kế bên sau nó là t3 sẽ được chọn
      useWorkspaceStore.setState({ activeTabId: t1.id });
      store.closeTab(t1.id);
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().activeTabId).toBe(t3.id);
    });

    it("AC4: closeTab tab đang mở ở cuối chọn tab kế bên trước nó", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Multi Tab Test 2", engine: "postgres" });
      const t1 = store.createTab(p.id, "Tab 1");
      const t2 = store.createTab(p.id, "Tab 2");

      // Active tab 2 (cuối cùng)
      useWorkspaceStore.setState({ activeTabId: t2.id });

      store.closeTab(t2.id);

      const state = useWorkspaceStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe(t1.id);
      // Chọn tab kế bên trước nó là t1
      expect(state.activeTabId).toBe(t1.id);
    });

    it("AC5: reorderTab cập nhật position liên tục 0..n-1, không để khoảng trống", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Reorder Test", engine: "postgres" });
      const t0 = store.createTab(p.id, "T0");
      const t1 = store.createTab(p.id, "T1");
      const t2 = store.createTab(p.id, "T2");
      const t3 = store.createTab(p.id, "T3");

      // Kéo T0 từ vị trí 0 sang vị trí 2: thứ tự mới sẽ là T1, T2, T0, T3
      store.reorderTab(t0.id, 2);

      let projectTabs = useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.projectId === p.id)
        .sort((a, b) => a.position - b.position);

      expect(projectTabs.map((t) => t.id)).toEqual([t1.id, t2.id, t0.id, t3.id]);
      expect(projectTabs.map((t) => t.position)).toEqual([0, 1, 2, 3]);

      // Kéo T3 từ vị trí 3 về vị trí 0: thứ tự mới là T3, T1, T2, T0
      store.reorderTab(t3.id, 0);

      projectTabs = useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.projectId === p.id)
        .sort((a, b) => a.position - b.position);

      expect(projectTabs.map((t) => t.id)).toEqual([t3.id, t1.id, t2.id, t0.id]);
      expect(projectTabs.map((t) => t.position)).toEqual([0, 1, 2, 3]);

      // Ca biên: toIndex vượt biên âm (-10) và quá lớn (999)
      store.reorderTab(t0.id, -10); // dời về 0
      projectTabs = useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.projectId === p.id)
        .sort((a, b) => a.position - b.position);
      expect(projectTabs[0].id).toBe(t0.id);
      expect(projectTabs.map((t) => t.position)).toEqual([0, 1, 2, 3]);

      store.reorderTab(t0.id, 999); // dời về cuối
      projectTabs = useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.projectId === p.id)
        .sort((a, b) => a.position - b.position);
      expect(projectTabs[3].id).toBe(t0.id);
      expect(projectTabs.map((t) => t.position)).toEqual([0, 1, 2, 3]);
    });

    it("Ca biên: updateTabSql với chuỗi 2MB", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Big Data Project", engine: "postgres" });
      const t = store.createTab(p.id, "HugeQuery.sql");

      // Chuỗi 2MB = 2 * 1024 * 1024 ký tự
      const bigSql = "SELECT '" + "x".repeat(2 * 1024 * 1024) + "';";
      expect(bigSql.length).toBeGreaterThan(2 * 1024 * 1024);

      store.updateTabSql(t.id, bigSql);

      const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === t.id);
      expect(tab?.sql).toBe(bigSql);
      expect(tab?.sql.length).toBe(bigSql.length);
    });

    it("Ca biên: Các hàm gọi với tab id hoặc project id không tồn tại không gây crash", () => {
      const store = useWorkspaceStore.getState();
      expect(() => store.renameProject("invalid-p-id", "New Name")).not.toThrow();
      expect(() => store.deleteProject("invalid-p-id")).not.toThrow();
      expect(() => store.renameTab("invalid-t-id", "New Tab Name")).not.toThrow();
      expect(() => store.closeTab("invalid-t-id")).not.toThrow();
      expect(() => store.reorderTab("invalid-t-id", 1)).not.toThrow();
      expect(() => store.updateTabSql("invalid-t-id", "SELECT 1;")).not.toThrow();
    });
  });
});
