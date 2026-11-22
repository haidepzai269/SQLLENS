import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootWorkspace, disposeWorkspace, flushWorkspace, hasUnflushedFailures } from "./hydrate";
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

  it("Ca biên: Đóng tab ngay sau khi gõ không để tab sống lại sau F5", async () => {
    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory, delayMs: 30 });

    // Tab mới vừa gõ vài ký tự rồi đóng trước khi debounce kịp ghi.
    const second = useWorkspaceStore.getState().createTab(projectId, "Query 2");
    useWorkspaceStore.getState().updateTabSql(second.id, "SELECT 'ghost';");
    useWorkspaceStore.getState().closeTab(second.id);

    await waitMs(80);
    await flushWorkspace();

    // Giả lập F5: nạp lại từ cùng IndexedDB.
    await disposeWorkspace();
    useWorkspaceStore.getState().reset();
    await bootWorkspace(GUEST_SCOPE, { factory });

    // Tab đã đóng không được ghi lại vào IndexedDB (không có tab "ma").
    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs.map((t) => t.name)).toEqual(["Query 1"]);
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

  // Reviewer vòng 5 (R2): trần 1500 ms chỉ bọc `projectWrites`, còn `tabAutosave.dispose()` chạy
  // TRƯỚC đó và bên trong nó `await Promise.all(inFlight)` không có hạn. Một transaction tab treo
  // vẫn treo `disposeWorkspace` — và `bootWorkspace` gọi hàm này nên treo cả ứng dụng. Đo được
  // trước khi sửa: `TAB_HANG: outcome=HUNG ms=6001`.
  it("R2: transaction tab treo thì disposeWorkspace vẫn trả về trong hạn", async () => {
    // Bọc factory TRƯỚC khi boot: phiên mở db qua factory này nên phần bọc mới có tác dụng.
    // (Bọc sau khi boot thì db đã mở bằng factory thật và `transaction` không bị đổi.)
    const flag = { hang: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            if (mode !== "readwrite") return tx;
            const realStore = tx.objectStore.bind(tx);
            tx.objectStore = ((name: string) => {
              const s = realStore(name);
              if (name === "tabs" && flag.hang) {
                // Request không bao giờ resolve: đúng dạng "transaction treo" khi tab bị đóng
                // giữa chừng hoặc db bị tab khác đang mở bản cũ block.
                s.put = (() => ({}) as IDBRequest<IDBValidKey>) as IDBObjectStore["put"];
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { tabId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    // Ghi một tab rồi để debounce chạy: lượt ghi treo trong `inFlight`.
    flag.hang = true;
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'treo'");
    await waitMs(60);

    const started = Date.now();
    await disposeWorkspace();
    const elapsed = Date.now() - started;

    // Phải trả về gần trần 1500 ms, không treo tới hạn test.
    expect(elapsed).toBeLessThan(4000);
  }, 10000);

  // Reviewer vòng 6, lỗi 4a: xoá tab/project lúc đĩa hỏng làm `failedWrites` giữ key `tab:<id>`
  // VĨNH VIỄN (bản ghi đã rời store nên không còn lượt ghi nào dùng lại key đó) →
  // `hasUnflushedFailures()` đúng mãi → nút Lưu cloud chết tới khi F5, và chặn luôn việc lưu
  // những dự án khác không liên quan. Xoá hỏng chỉ để lại bản ghi ma, KHÔNG được chặn đẩy cloud.
  it("4a: xoá tab lúc đĩa hỏng KHÔNG được khoá nút Lưu vĩnh viễn", async () => {
    const flag = { broken: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            if (mode !== "readwrite") return tx;
            const realStore = tx.objectStore.bind(tx);
            tx.objectStore = ((name: string) => {
              const s = realStore(name);
              if (name === "tabs" && flag.broken) {
                s.delete = (() => {
                  throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                }) as IDBObjectStore["delete"];
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { projectId, tabId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });
    const second = useWorkspaceStore.getState().createTab(projectId);
    const secondId = second?.id ?? useWorkspaceStore.getState().tabs[1].id;
    await waitMs(40);

    // Xoá tab trong lúc đĩa hỏng: lượt xoá thất bại.
    flag.broken = true;
    useWorkspaceStore.getState().closeTab(secondId);
    await waitMs(60);

    // Đĩa hết lỗi.
    flag.broken = false;

    // Phải cho Lưu tiếp: bản ghi ma trên đĩa không nằm trong payload nên nội dung đẩy vẫn đúng.
    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);
    void tabId;
  }, 10000);

  // Cùng gốc lỗi 4a nhưng ở hàng project, và hệ quả nặng hơn: dự án ma bị xoá hỏng nằm NGOÀI
  // payload của dự án đang đẩy, nên chặn toàn cục là chặn nhầm — người dùng không lưu được cả
  // những dự án không liên quan gì tới lỗi.
  it("4a: xoá project lúc đĩa hỏng KHÔNG được chặn việc Lưu dự án khác", async () => {
    const flag = { broken: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            if (mode !== "readwrite") return tx;
            const realStore = tx.objectStore.bind(tx);
            tx.objectStore = ((name: string) => {
              const s = realStore(name);
              if (name === "projects" && flag.broken) {
                const realDelete = s.delete.bind(s);
                s.delete = ((key: IDBValidKey) => {
                  throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                }) as IDBObjectStore["delete"];
                void realDelete;
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });
    const other = useWorkspaceStore.getState().createProject({ name: "Dự án khác", engine: "postgres" });
    await waitMs(60);

    // Xoá dự án ĐẦU trong lúc đĩa hỏng: lượt xoá thất bại.
    flag.broken = true;
    useWorkspaceStore.getState().deleteProject(projectId);
    await waitMs(60);

    flag.broken = false;

    // Dự án còn lại phải lưu được bình thường.
    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);
    void other;
  }, 10000);
});
