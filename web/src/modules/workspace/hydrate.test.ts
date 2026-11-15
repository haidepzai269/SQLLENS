import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootWorkspace, disposeWorkspace, flushWorkspace } from "./hydrate";
import { useWorkspaceStore } from "./store";
import type { WorkspaceScope } from "./types";

const GUEST_SCOPE: WorkspaceScope = { kind: "guest" };
const USER_SCOPE: WorkspaceScope = { kind: "user", userId: "user-123" };

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Workspace Hydrate & Persistence (Task124)", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
    useWorkspaceStore.getState().reset();
  });

  afterEach(async () => {
    await disposeWorkspace();
    useWorkspaceStore.getState().reset();
  });

  it("AC2: Lần mở đầu tiên tự tạo đúng 1 project 'Mặc định' (postgres) và 1 tab 'Query 1'", async () => {
    const { projectId, tabId } = await bootWorkspace(GUEST_SCOPE, { factory });

    expect(projectId).toBeDefined();
    expect(tabId).toBeDefined();

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]).toMatchObject({
      id: projectId,
      name: "Mặc định",
      engine: "postgres",
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({
      id: tabId,
      projectId,
      name: "Query 1",
      sql: "",
      position: 0,
    });
    expect(state.activeProjectId).toBe(projectId);
    expect(state.activeTabId).toBe(tabId);
    expect(state.saveState).toBe("idle");
  });

  it("AC1 & AC2: Gõ SQL, F5 giả lập → nội dung còn nguyên, văn bản khớp 100%, không tạo trùng project/tab", async () => {
    // 1. Boot lần đầu
    const { projectId, tabId } = await bootWorkspace(GUEST_SCOPE, { factory });

    // 2. Gõ SQL
    const sqlText = "SELECT id, name, created_at FROM orders WHERE status = 'paid';";
    useWorkspaceStore.getState().updateTabSql(tabId, sqlText);

    // 3. Flush autosave
    await flushWorkspace();

    // 4. Giả lập F5: dispose workspace hiện tại, reset store về trắng
    await disposeWorkspace();
    useWorkspaceStore.getState().reset();
    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);

    // 5. Boot lại từ cùng IndexedDB
    const reloaded = await bootWorkspace(GUEST_SCOPE, { factory });

    expect(reloaded.projectId).toBe(projectId);
    expect(reloaded.tabId).toBe(tabId);

    const reloadedState = useWorkspaceStore.getState();
    // AC2: Không tạo thêm project hay tab trùng
    expect(reloadedState.projects).toHaveLength(1);
    expect(reloadedState.tabs).toHaveLength(1);

    // AC1: Nội dung văn bản khớp 100%
    expect(reloadedState.tabs[0].sql).toBe(sqlText);
  });

  it("AC1: Autosave debounce gom ghi sau delayMs", async () => {
    const { tabId } = await bootWorkspace(GUEST_SCOPE, { factory, delayMs: 40 });

    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 1;");
    await waitMs(15);
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 12;");
    await waitMs(15);
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 123;");

    // Đợi hơn delayMs (40ms) để autosave tự ghi vào IndexedDB
    await waitMs(70);

    // Dọn store và nạp lại để kiểm tra
    await disposeWorkspace();
    useWorkspaceStore.getState().reset();
    await bootWorkspace(GUEST_SCOPE, { factory });

    expect(useWorkspaceStore.getState().tabs[0].sql).toBe("SELECT 123;");
  });

  it("Tách biệt dữ liệu giữa Guest và User", async () => {
    // 1. Guest boot và gõ SQL
    const guest = await bootWorkspace(GUEST_SCOPE, { factory });
    useWorkspaceStore.getState().updateTabSql(guest.tabId, "SELECT 'guest';");
    await flushWorkspace();

    // 2. User boot và gõ SQL
    const user = await bootWorkspace(USER_SCOPE, { factory });
    expect(user.projectId).not.toBe(guest.projectId);
    useWorkspaceStore.getState().updateTabSql(user.tabId, "SELECT 'user_alice';");
    await flushWorkspace();

    // 3. Quay lại Guest: dữ liệu Guest vẫn toàn vẹn
    await bootWorkspace(GUEST_SCOPE, { factory });
    const guestState = useWorkspaceStore.getState();
    expect(guestState.tabs[0].sql).toBe("SELECT 'guest';");

    // 4. Quay lại User: dữ liệu User vẫn toàn vẹn
    await bootWorkspace(USER_SCOPE, { factory });
    const userState = useWorkspaceStore.getState();
    expect(userState.tabs[0].sql).toBe("SELECT 'user_alice';");
  });

  it("Ca biên: IndexedDB bị chặn (chế độ riêng tư) fallback in-memory an toàn, không crash, báo saveState error", async () => {
    const brokenFactory = {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => {
          if (req.onerror) {
            Object.defineProperty(req, "error", {
              value: new DOMException("The user denied permission to access the database", "SecurityError"),
            });
            req.onerror(new Event("error") as unknown as ProgressEvent<EventTarget>);
          }
        }, 1);
        return req;
      },
    } as unknown as IDBFactory;

    // Không throw lỗi, ứng dụng vẫn khởi động thành công
    const result = await bootWorkspace(GUEST_SCOPE, { factory: brokenFactory });
    expect(result.projectId).toBeDefined();
    expect(result.tabId).toBeDefined();

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.tabs).toHaveLength(1);
    expect(state.saveState).toBe("error");

    // Người dùng vẫn có thể thao tác với store
    useWorkspaceStore.getState().updateTabSql(result.tabId, "SELECT 'in-memory';");
    expect(useWorkspaceStore.getState().tabs[0].sql).toBe("SELECT 'in-memory';");

    // flushWorkspace an toàn không ném ngoại lệ
    await expect(flushWorkspace()).resolves.toBeUndefined();
  });

  it("Ca biên: Hai tab trình duyệt cùng mở một IndexedDB ghi tuần tự an toàn", async () => {
    // Giả lập Tab A và Tab B cùng mở DB qua cùng factory
    const sessionA = await bootWorkspace(GUEST_SCOPE, { factory });
    useWorkspaceStore.getState().updateTabSql(sessionA.tabId, "SELECT 'from tab A';");
    await flushWorkspace();

    // Tab B mở cùng DB
    const sessionB = await bootWorkspace(GUEST_SCOPE, { factory });
    expect(sessionB.projectId).toBe(sessionA.projectId);
    expect(sessionB.tabId).toBe(sessionA.tabId);
    expect(useWorkspaceStore.getState().tabs[0].sql).toBe("SELECT 'from tab A';");

    // Tab B cập nhật SQL
    useWorkspaceStore.getState().updateTabSql(sessionB.tabId, "SELECT 'from tab B';");
    await flushWorkspace();

    // Tab A reload (boot lại) nhận được bản ghi mới nhất
    await bootWorkspace(GUEST_SCOPE, { factory });
    expect(useWorkspaceStore.getState().tabs[0].sql).toBe("SELECT 'from tab B';");
  });
});
