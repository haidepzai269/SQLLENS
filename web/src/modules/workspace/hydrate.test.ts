import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspaceDb } from "./db";
import { bootWorkspace, disposeWorkspace, flushWorkspace, hasUnflushedFailures, markWorkspacePurged } from "./hydrate";
import { getRepository } from "./repository";
import { useWorkspaceStore } from "./store";
import type { WorkspaceProject, WorkspaceScope, WorkspaceTab } from "./types";

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

    // Phải trả về gần ngân sách flush, không treo tới hạn test.
    expect(elapsed).toBeLessThan(5000);
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

  // Cùng lớp lỗi R2 nhưng ở đường thử lại: transaction IndexedDB có thể treo vĩnh viễn, và
  // `pushProject` gọi `flushWorkspace()` nên treo ở đây là treo luôn nút Lưu. Mỗi lần thử lại phải
  // có trần, hết hạn thì coi như vẫn hỏng và để lần sau.
  it("4a: thử lại lượt xoá bị treo vẫn trả về trong hạn", async () => {
    // Lần xoá ĐẦU ném lỗi (để có entry trong `failedDeletes`); các lần SAU trả về request không
    // bao giờ resolve — đúng dạng "transaction treo", buộc đường thử lại phải có trần.
    const state = { calls: 0 };
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
              if (name === "tabs") {
                s.delete = (() => {
                  state.calls += 1;
                  if (state.calls === 1) {
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  // Treo hẳn: không resolve, không reject.
                  return {} as IDBRequest<undefined>;
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

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });
    const second = useWorkspaceStore.getState().createTab(projectId);
    await waitMs(40);

    useWorkspaceStore.getState().closeTab(second.id);
    await waitMs(60);
    expect(state.calls).toBeGreaterThan(0);

    // Đường thử lại bị treo: `flushWorkspace` phải trả về trong hạn, không treo theo.
    const started = Date.now();
    await flushWorkspace();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
  }, 15000);

  // Reviewer vòng 7, N4: trần tính cho TỪNG entry cộng dồn thành (số entry) × trần, và số entry
  // không bị chặn — đo được 6 entry treo → một lần Lưu mất 4,5 giây. Ngân sách phải là CHUNG cho cả
  // vòng, để nút Lưu luôn trả về trong hạn dù có bao nhiêu entry đi nữa.
  it("N4: nhiều lượt thử lại bị treo vẫn chỉ tốn một ngân sách chung", async () => {
    const state = { calls: 0 };
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
              if (name === "tabs") {
                s.delete = (() => {
                  state.calls += 1;
                  // Mọi lượt xoá đều ném ngay (để tích nhiều entry), riêng các lượt THỬ LẠI thì treo:
                  // phân biệt bằng số lần gọi — 6 lượt đầu là lúc xoá, sau đó là thử lại.
                  if (state.calls <= 6) {
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  return {} as IDBRequest<undefined>;
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

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    // Tạo 6 tab rồi đóng cả 6 → 6 entry `failedDeletes` khác key nhau.
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(useWorkspaceStore.getState().createTab(projectId).id);
    }
    await waitMs(40);
    for (const id of ids) useWorkspaceStore.getState().closeTab(id);
    await waitMs(80);
    expect(state.calls).toBeGreaterThanOrEqual(6);

    // Cả 6 lượt thử lại đều treo. Tổng thời gian phải quanh MỘT ngân sách chung (2 s), không phải
    // 6 × 2 s.
    const started = Date.now();
    await flushWorkspace();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
  }, 20000);
  // TÊN key nên đĩa hết lỗi rồi vẫn kẹt vĩnh viễn — `hasUnflushedFailures()` đúng mãi, chặn cả
  // những dự án khác không liên quan, và xoá chính dự án đó cũng không gỡ được.
  it("N3: đĩa hết lỗi thì lần Lưu sau phải thử lại được lượt ghi project đã hỏng", async () => {
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
                s.put = (() => {
                  throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                }) as IDBObjectStore["put"];
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

    // Đổi tên trong lúc đĩa hỏng → lượt ghi hỏng, ghi dấu nợ.
    flag.broken = true;
    useWorkspaceStore.getState().renameProject(projectId, "TEN-MOI");
    await waitMs(60);
    expect(hasUnflushedFailures()).toBe(true);

    // Đĩa hết lỗi. Lần Lưu sau phải THỬ LẠI và thành công, không được kẹt.
    flag.broken = false;
    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);
  }, 10000);

  // Reviewer vòng 7, N5: `disposeWorkspace()` bỏ rơi các lượt xoá đã hỏng, nên bản ghi ma nằm lại
  // trên đĩa và SỐNG LẠI sau F5 (đo được `ghostAliveAfterF5=true`).
  it("N5: đóng phiên không được để bản ghi đã xoá sống lại sau F5", async () => {
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

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });
    const second = useWorkspaceStore.getState().createTab(projectId);
    await waitMs(40);

    // Xoá tab trong lúc đĩa hỏng → lượt xoá hỏng.
    flag.broken = true;
    useWorkspaceStore.getState().closeTab(second.id);
    await waitMs(60);

    // Đĩa hết lỗi rồi đóng phiên: phải thử lại trước khi teardown.
    flag.broken = false;
    await disposeWorkspace();

    // F5 giả lập: mở lại và kiểm tab đã xoá không sống lại.
    await bootWorkspace(GUEST_SCOPE, { factory, delayMs: 10 });
    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs.some((t) => t.id === second.id)).toBe(false);
  }, 15000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // Vòng 8: reviewer đo được 4 lỗi Cao + 2 phụ trên bản dùng "sổ nợ" thủ công. Bản viết lại bỏ hẳn
  // sổ nợ và đối chiếu đĩa với store, nên các test dưới đây đo TRỰC TIẾP trên đĩa: đó là sự thật duy
  // nhất mà code dựa vào, không phải một tập trạng thái có thể quên cập nhật.
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Đọc thẳng nội dung đĩa, không đi qua store hay bộ nhớ đệm nào. */
  async function readDisk(): Promise<{ projects: WorkspaceProject[]; tabs: WorkspaceTab[] }> {
    const db = await openWorkspaceDb(factory);
    try {
      const repo = getRepository(db);
      const projects = await repo.listProjects(GUEST_SCOPE);
      const perProject = await Promise.all(projects.map((p) => repo.listTabs(p.id)));
      return { projects, tabs: perProject.flat() };
    } finally {
      db.close();
    }
  }

  /**
   * Chặn `put` trên một store: ném lỗi quota khi `shouldFail` trả về true.
   *
   * `shouldFail` nhận giá trị sắp ghi để test chọn đúng lượt nào hỏng — nếu nó luôn trả false thì
   * helper này KHÔNG chặn gì cả, và mọi test dùng nó sẽ xanh oan.
   */
  function sabotagePut(storeName: "projects" | "tabs", shouldFail: (value: { name?: string; sql?: string }) => boolean): IDBFactory {
    const realOpen = factory.open.bind(factory);
    return {
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
              if (name === storeName) {
                const realPut = s.put.bind(s);
                s.put = ((value: { name?: string; sql?: string }, key?: IDBValidKey) => {
                  if (shouldFail(value)) {
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  return realPut(value, key);
                }) as IDBObjectStore["put"];
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;
  }

  // Lỗi 1 (Cao): hàng project không có "thế hệ", nên một lượt ghi CŨ chạy muộn xoá mất dấu lỗi của
  // lượt MỚI. Kịch bản reviewer đo: đổi tên TEN-A (chậm) → đổi tên TEN-B (hỏng) → TEN-A xong muộn
  // → đĩa còn TEN-A, store là TEN-B, mà Lưu vẫn báo OK và đẩy TEN-A lên cloud.
  //
  // Bản đối chiếu không có "dấu lỗi" nào để xoá: nó đọc đĩa, thấy TEN-A ≠ TEN-B, ghi lại TEN-B.
  it("V8-1: lượt ghi cũ chạy muộn không được để đĩa lệch store rồi Lưu báo thành công", async () => {
    const flag = { broken: false };
    const gateCtl: { release: () => void } = { release: () => undefined };
    void new Promise<void>((resolve) => {
      gateCtl.release = resolve;
    });
    let firstSeen = false;
    // Lượt ghi TEN-A "xuống đĩa muộn": transaction của nó commit sau khi cổng mở, tức SAU lượt
    // TEN-B. Mô phỏng đúng điều reviewer đo: lượt cũ settle muộn hơn lượt mới.
    const lateWrites: Array<() => void> = [];

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
              if (name === "projects") {
                const realPut = s.put.bind(s);
                s.put = ((value: { name?: string }, key?: IDBValidKey) => {
                  if (!firstSeen && value?.name === "TEN-A") {
                    firstSeen = true;
                    // Ghi TEN-A vào một transaction KHÁC, chỉ mở khi cổng mở. Transaction hiện tại
                    // commit ngay (rỗng) để không chặn store — đúng như một lượt ghi bị hoãn.
                    lateWrites.push(() => {
                      const late = opened.transaction(["projects"], "readwrite");
                      late.objectStore("projects").put(value, key);
                    });
                    const fake = {} as IDBRequest<IDBValidKey>;
                    queueMicrotask(() => fake.onsuccess?.(new Event("success") as never));
                    return fake;
                  }
                  if (flag.broken && value?.name === "TEN-B") {
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  return realPut(value, key);
                }) as IDBObjectStore["put"];
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

    // Lượt 1: đổi tên TEN-A, bị hoãn.
    useWorkspaceStore.getState().renameProject(projectId, "TEN-A");
    await waitMs(30);
    expect(firstSeen).toBe(true);

    // Lượt 2: đổi tên TEN-B trong lúc đĩa hỏng → lượt này hỏng thật.
    flag.broken = true;
    useWorkspaceStore.getState().renameProject(projectId, "TEN-B");
    await waitMs(30);

    // Lượt 1 mới thật sự xuống đĩa, SAU lượt 2.
    gateCtl.release();
    await waitMs(0);
    for (const write of lateWrites) write();
    await waitMs(60);

    // Đĩa hết lỗi rồi Lưu: đĩa phải khớp store (TEN-B), không được để TEN-A cũ nằm lại.
    flag.broken = false;
    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);

    const disk = await readDisk();
    const onDisk = disk.projects.find((p) => p.id === projectId);
    expect(onDisk?.name).toBe("TEN-B");
    expect(useWorkspaceStore.getState().projects.find((p) => p.id === projectId)?.name).toBe("TEN-B");
  }, 15000);

  // Lỗi 2 (Cao): đường thử lại phát lại closure chụp lúc hỏng, nên nó ghi ĐĨA LÙI LẠI. Reviewer đo:
  // đĩa TEN-B, store TEN-C, thử lại ghi TEN-B đè lên → đẩy TEN-B lên cloud.
  //
  // Bản đối chiếu luôn ghi giá trị HIỆN TẠI của store, nên không có closure cũ nào để phát lại.
  // Test phải có HAI lần Lưu: lần đầu hỏng (tạo "nợ" để mà phát lại), rồi đổi tên tiếp, rồi Lưu
  // lại. Chỉ một lần Lưu thì không có gì được phát lại và test sẽ xanh oan.
  it("V8-2: thử lại phải ghi giá trị hiện tại của store, không ghi lại ảnh chụp cũ", async () => {
    const flag = { broken: false };
    const sabotaged = sabotagePut("projects", () => flag.broken);

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    // TEN-B: lượt ghi hỏng (đĩa đầy).
    flag.broken = true;
    useWorkspaceStore.getState().renameProject(projectId, "TEN-B");
    await waitMs(40);

    // Lần Lưu ĐẦU: hỏng, và đây là lúc bản sổ nợ cũ chụp lại ảnh TEN-B.
    await expect(flushWorkspace()).rejects.toThrow();
    expect(hasUnflushedFailures()).toBe(true);

    // TEN-C: đổi tên tiếp trong lúc vẫn hỏng → store là TEN-C, đĩa vẫn TEN-A cũ.
    useWorkspaceStore.getState().renameProject(projectId, "TEN-C");
    await waitMs(40);

    // Đĩa hết lỗi rồi Lưu LẦN HAI. Thử lại phải ghi TEN-C, KHÔNG được phát lại ảnh TEN-B.
    flag.broken = false;
    await expect(flushWorkspace()).resolves.toBeUndefined();

    const disk = await readDisk();
    const onDisk = disk.projects.find((p) => p.id === projectId);
    expect(onDisk?.name).toBe("TEN-C");
    expect(onDisk?.name).not.toBe("TEN-B");
  }, 15000);

  // Lỗi 3 (Cao): `flushWorkspace()` không có trần cho các lượt ghi đang bay — reviewer đo được
  // 8001 ms không trả về (treo vĩnh viễn). Và nếu chỉ đặt trần mà không ghi nhận "đĩa lệch store"
  // thì lại tái sinh đúng lỗi gốc Task154: treo, không có nợ, Lưu báo OK và đẩy bản cũ.
  //
  // Bản đối chiếu: treo → hết ngân sách → `diskMatchesStore = false` → `hasUnflushedFailures()`
  // đúng → chặn Lưu. Đo cả hai vế.
  it("V8-3: lượt ghi treo vừa phải có trần, vừa phải bị coi là chưa xuống đĩa", async () => {
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
              if (name === "projects" && flag.hang) {
                // Treo hẳn: không resolve, không reject.
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

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    flag.hang = true;
    useWorkspaceStore.getState().renameProject(projectId, "TEN-TREO");
    await waitMs(30);

    const started = Date.now();
    const outcome = await flushWorkspace().then(
      () => "RESOLVED",
      () => "THREW",
    );
    const elapsed = Date.now() - started;

    // Vế 1: phải trả về trong hạn, không treo tới hạn test.
    expect(elapsed).toBeLessThan(8000);
    // Vế 2: và phải biết là đĩa chưa khớp store — nếu không thì `pushProject` đẩy bản cũ lên cloud.
    expect(outcome).toBe("THREW");
    expect(hasUnflushedFailures()).toBe(true);
  }, 20000);

  // Cùng lỗi 3 nhưng ở đường ĐỌC: `raceWithDeadline` chỉ bọc các lượt ghi đang bay, còn bước đối
  // chiếu tự gọi `repo.listProjects()`/`listTabs()`. Một transaction đọc treo sẽ treo `flushWorkspace`
  // vĩnh viễn nếu chính bước đó không có trần. Test trên không bắt được lớp này vì lượt ghi treo đã
  // làm hết ngân sách trước khi tới bước đọc.
  it("V8-3b: transaction ĐỌC treo cũng phải có trần, không treo nút Lưu", async () => {
    const flag = { hangRead: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            // Chỉ chặn đường ĐỌC: `flushWorkspace` gọi `listProjects`/`listTabs` để đối chiếu.
            if (mode !== "readonly" || !flag.hangRead) return tx;
            const realStore = tx.objectStore.bind(tx);
            tx.objectStore = ((name: string) => {
              const s = realStore(name);
              // Request không bao giờ resolve → transaction treo, `requestDone` chờ mãi.
              s.getAll = (() => ({}) as IDBRequest<unknown[]>) as IDBObjectStore["getAll"];
              s.index = (() => ({ getAll: (() => ({}) as IDBRequest<unknown[]>) as IDBIndex["getAll"] }) as unknown as IDBIndex) as IDBObjectStore["index"];
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    // Không có lượt ghi nào đang bay: chỉ có đường đọc bị treo.
    flag.hangRead = true;

    const started = Date.now();
    const outcome = await flushWorkspace().then(
      () => "RESOLVED",
      () => "THREW",
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(8000);
    expect(outcome).toBe("THREW");
    expect(hasUnflushedFailures()).toBe(true);
  }, 20000);

  // Lỗi 4 (Trung bình): `DISPOSE_WRITE_TIMEOUT_MS` (1500) < ngân sách thử lại (2000), nên lần thử
  // lại bị cắt giữa chừng và bản ghi đã xoá SỐNG LẠI sau F5 — tái sinh đúng N5. Reviewer đo:
  // `disposeElapsed=1501, ghostAliveInStore=true, ghostOnDisk=true, retryNeededMs=1600`.
  //
  // Đo hệ quả trực tiếp: lượt xoá treo hẳn thì `disposeWorkspace()` phải chờ ÍT NHẤT một ngân sách
  // thử lại trước khi bỏ cuộc. Trần dispose nhỏ hơn ngân sách (1500 < 2000) sẽ trả về sớm hơn thế,
  // và mọi lần thử lại cần nhiều hơn 1500 ms đều bị cắt ngang.
  // Reviewer vòng 8, lỗi 5. `DISPOSE_WRITE_TIMEOUT_MS` từng là 1500 ms trong khi `FLUSH_BUDGET_MS`
  // là 2000 ms, nên `disposeWorkspace` cắt ngang đường thử lại giữa chừng và bản ghi đã xoá sống lại
  // sau F5. Test cũ chỉ đo `elapsed >= 1900` — kiểm chi tiết cài đặt, không kiểm kết quả.
  //
  // Bất biến thật: lượt xoá hỏng TẠM THỜI (vài lần đầu) mà `disposeWorkspace` chạy thì phải cứu được
  // — tức là nó phải cho đường thử lại đủ thời gian để thử lại THÀNH CÔNG, không chỉ đủ lâu để hết
  // giờ. Ca hỏng vĩnh viễn (đĩa đầy thật) thì bỏ cuộc sớm là đúng, xem V8-4b.
  it("V8-4: đóng phiên phải cho đường thử lại đủ thời gian để CỨU được lượt xoá hỏng tạm thời", async () => {
    const state = { fails: 0 };
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
              if (name === "tabs") {
                const realDelete = s.delete.bind(s);
                s.delete = ((k: IDBValidKey) => {
                  // Hỏng 3 lần đầu rồi thành công: mô phỏng quota tạm thời.
                  if (state.fails < 3) {
                    state.fails += 1;
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  return realDelete(k);
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

    const { projectId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });
    const second = useWorkspaceStore.getState().createTab(projectId);
    await waitMs(40);

    // Đóng tab trong lúc các lượt xoá đầu còn hỏng.
    useWorkspaceStore.getState().closeTab(second.id);
    await waitMs(60);

    await disposeWorkspace();

    // Đã thử lại ít nhất 3 lần (chứng minh đường thử lại thật sự chạy, không chỉ chờ rồi bỏ).
    expect(state.fails).toBe(3);

    // Và kết quả: bản ghi ma KHÔNG còn — nếu dispose cắt ngang thì nó sẽ sống lại sau F5.
    const db = await openWorkspaceDb(factory);
    try {
      const onDisk = await getRepository(db).listTabs(projectId);
      expect(onDisk.some((t) => t.id === second.id)).toBe(false);
    } finally {
      db.close();
    }
  }, 20000);

  // Lỗi 5 (Trung bình): tab cũng có "nợ" như project, nhưng bản sổ nợ chỉ thêm đường thử lại cho
  // project (N3). Reviewer đo: đĩa hết lỗi rồi 5/5 lần bấm Lưu vẫn hỏng, `fetchCalls:0`, chỉ thoát
  // khi người dùng gõ thêm một ký tự. Bản đối chiếu không phân biệt tab hay project.
  it("V8-5: đĩa hết lỗi thì tab đã ghi hỏng cũng phải được ghi lại khi Lưu", async () => {
    const flag = { broken: false };
    const sabotaged = sabotagePut("tabs", () => flag.broken);

    const { tabId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    // Gõ trong lúc đĩa hỏng: lượt debounce hỏng.
    flag.broken = true;
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'BAN-MOI'");
    await waitMs(60);

    // Đĩa hết lỗi. Bấm Lưu (không gõ thêm ký tự nào) phải ghi được bản mới xuống đĩa.
    flag.broken = false;
    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);

    const disk = await readDisk();
    const onDisk = disk.tabs.find((t) => t.id === tabId);
    expect(onDisk?.sql).toBe("SELECT 'BAN-MOI'");
  }, 15000);

  // Lỗi 6 (Thấp): ngân sách không dùng chung giữa hai Map, nên tổng là 2 × ngân sách. Reviewer đo
  // `elapsedMs:3006` với `budgetMs:2000`. Bản đối chiếu chỉ có MỘT vòng lặp và MỘT deadline, nên
  // lệch bao nhiêu loại cũng chỉ tốn một ngân sách.
  it("V8-6: nhiều loại lệch khác nhau vẫn chỉ tốn một ngân sách", async () => {
    const flag = { broken: false };
    // Cả `put` lẫn `delete` đều hỏng NGAY (không treo): mỗi vòng đối chiếu hỏng ở cả hai loại, nên
    // nếu mỗi loại có ngân sách riêng thì tổng sẽ là 2 × ngân sách.
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
              if (flag.broken) {
                s.put = (() => {
                  throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                }) as IDBObjectStore["put"];
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
    await waitMs(40);

    // Cả hai loại lệch cùng lúc: một tab cần GHI (gõ mới) và một tab cần XOÁ (đã đóng).
    flag.broken = true;
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'MOI'");
    useWorkspaceStore.getState().closeTab(second.id);
    await waitMs(60);

    const started = Date.now();
    await flushWorkspace().catch(() => undefined);
    const elapsed = Date.now() - started;

    // Một ngân sách (2 s), không phải 2 × 2 s.
    expect(elapsed).toBeLessThan(3500);
    expect(hasUnflushedFailures()).toBe(true);
  }, 20000);

  // Vòng 9, lỗi do chính bản viết lại sinh ra. `reconcileOnce` chụp store ở ĐẦU hàm rồi await
  // nhiều lượt (đọc đĩa, ghi, đọc lại). Nếu người dùng gõ tiếp trong cửa sổ đó, bản chụp đã cũ:
  // ghi B xuống đĩa → gõ thành C → đọc lại đĩa thấy B khớp ảnh chụp B → kết luận "khớp" và
  // `flushWorkspace` báo THÀNH CÔNG trong khi đĩa là B còn store là C.
  //
  // Đây đúng là bug gốc của Task154 (`pushProject` đọc tab TỪ ĐĨA ở `sync.ts:337` nên đẩy B lên
  // cloud), chỉ khác đường vào. Đo trước khi sửa: `outcome=RESOLVED inStore="C" onDisk="B"`.
  it("V9-1: gõ tiếp trong lúc đang Lưu không được để Lưu báo thành công với đĩa cũ hơn store", async () => {
    // Phải chèn C vào ĐÚNG cửa sổ nguy hiểm: SAU khi `reconcileOnce` đã chụp ảnh store, và TRONG
    // lúc nó đọc đĩa. Chèn bằng `setTimeout(1)` thì tuỳ tốc độ máy: nếu flush kịp xong trước khi C
    // xuất hiện thì "RESOLVED" là ĐÚNG (C sẽ được debounce ghi sau) và test đỏ oan — đã đo được
    // đúng hiện tượng đó khi chạy cả file.
    //
    // Chèn ở lượt GHI cũng sai: reconcile ghi theo ảnh chụp cũ rồi tự sửa ở vòng sau, nên đột biến
    // bỏ lớp bảo vệ vẫn xanh. Móc vào transaction ĐỌC của store `tabs` — đó là bước đọc đĩa nằm sau
    // ảnh chụp, nên ảnh chụp đã cũ mà chưa ai kiểm.
    const arm = { armed: false, fired: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            if (mode === "readwrite") return tx;
            const isTabs = names === "tabs" || (Array.isArray(names) && names.includes("tabs"));
            if (!isTabs || !arm.armed || arm.fired) return tx;
            arm.fired = true;
            // Người dùng gõ tiếp ngay lúc này: store thành C trong khi ảnh chụp vẫn là B.
            useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'C'");
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { tabId } = await bootWorkspace(GUEST_SCOPE, { factory: sabotaged, delayMs: 10 });

    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'A'");
    await waitMs(50);
    await flushWorkspace();

    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'B'");
    arm.armed = true;
    const outcome = await flushWorkspace().then(
      () => "RESOLVED",
      () => "THREW",
    );
    arm.armed = false;

    // Chỉ có ý nghĩa nếu cửa sổ thật sự bị chèn — nếu không, test đang kiểm một tình huống khác.
    expect(arm.fired).toBe(true);

    const inStore = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId)?.sql;
    const disk = await readDisk();
    const onDisk = disk.tabs.find((t) => t.id === tabId)?.sql;

    // Hoặc đĩa khớp store, hoặc lần Lưu phải báo lỗi. Tuyệt đối không được "RESOLVED mà lệch".
    expect(`${outcome}:${onDisk === inStore ? "khop" : "LECH"}`).toBe(
      outcome === "RESOLVED" ? "RESOLVED:khop" : `${outcome}:LECH`,
    );
    if (outcome === "RESOLVED") expect(onDisk).toBe("SELECT 'C'");
  }, 20000);

  // Vòng 9, lỗi thứ hai do bản viết lại sinh ra: bước CHỜ và bước ĐO dùng chung một `deadline`.
  // Workspace lớn thì bước chờ ăn hết ngân sách, bước đo thấy hết hạn ngay vòng đầu, kết luận
  // `blocking` và ném — dù đĩa đã khớp store. Đo trước khi sửa: `[LOOP] iter=1 blocking=1 ms=2002`.
  //
  // Đây là "báo lỗi oan": người dùng không Lưu được dù mọi thứ đã xuống đĩa. Nguy hiểm hơn báo
  // thành công nhầm, vì nó khoá cứng tính năng và người dùng không có cách nào thoát ngoài F5.
  //
  // Kịch bản thật: workspace đã có nhiều tab, người dùng sửa MỘT tab rồi bấm Lưu.
  it("V9-2: workspace lớn, sửa một tab rồi Lưu vẫn phải thành công", async () => {
    await bootWorkspace(GUEST_SCOPE, { factory, delayMs: 5 });

    // 601 tab: ngưỡng mà bản trước đo được là luôn thất bại.
    for (let i = 0; i < 20; i += 1) {
      const p = useWorkspaceStore.getState().createProject({ name: `P${i}`, engine: "postgres" });
      for (let j = 0; j < 30; j += 1) {
        const t = useWorkspaceStore.getState().createTab(p.id);
        useWorkspaceStore.getState().updateTabSql(t.id, `SELECT ${j}`);
      }
    }
    // Chờ debounce ghi hết xuống đĩa: đây là trạng thái "đã ổn định" trước khi người dùng sửa.
    await waitMs(200);
    await flushWorkspace().catch(() => undefined);

    const first = useWorkspaceStore.getState().tabs[0];
    useWorkspaceStore.getState().updateTabSql(first.id, "SELECT 'SUA-MOT-TAB'");

    await expect(flushWorkspace()).resolves.toBeUndefined();
    expect(hasUnflushedFailures()).toBe(false);

    const disk = await readDisk();
    expect(disk.tabs.find((t) => t.id === first.id)?.sql).toBe("SELECT 'SUA-MOT-TAB'");
  }, 120000);
  // Reviewer vòng 9, lỗi 1 — hồi quy do chính bản viết lại gây ra, vi phạm AC2 Task129.
  //
  // Luồng đăng xuất thật: `flushWorkspace()` -> `purgeUserScope()` -> `logout()` -> `markAnon()` ->
  // đổi scope -> `disposeWorkspace()` -> `flushWorkspace(session)`. Bước cuối thấy store còn dữ liệu
  // mà đĩa rỗng nên tưởng "ghi hỏng" và ghi lại đúng những hàng vừa xoá. Nháp riêng tư sống lại
  // nguyên văn SQL. Đo được trước khi sửa: `sauPurge(userProjects=0)` -> `sauDoiScope(userProjects=1)`,
  // `sqlSongLai="SELECT 'bi-mat-nguoi-dung'"`.
  it("V9-3: xoá nháp cục bộ rồi đổi phiên KHÔNG được hồi sinh dữ liệu riêng tư", async () => {
    const { tabId } = await bootWorkspace(USER_SCOPE, { factory, delayMs: 5 });
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'bi-mat-nguoi-dung'");
    await waitMs(60);
    await flushWorkspace();

    // `purgeUserScope` xoá thẳng trên đĩa, không đi qua store.
    const db = await openWorkspaceDb(factory);
    try {
      const repo = getRepository(db);
      for (const p of await repo.listProjects(USER_SCOPE)) await repo.deleteProjectCascade(p.id);
    } finally {
      db.close();
    }
    markWorkspacePurged();

    // Đổi scope: đúng đường đi của `disposeWorkspace` lúc `markAnon()`.
    await disposeWorkspace();
    await bootWorkspace(GUEST_SCOPE, { factory });

    const db2 = await openWorkspaceDb(factory);
    try {
      const repo = getRepository(db2);
      const userProjects = await repo.listProjects(USER_SCOPE);
      const userTabs = (await Promise.all(userProjects.map((p) => repo.listTabs(p.id)))).flat();
      expect(userProjects).toHaveLength(0);
      expect(userTabs).toHaveLength(0);
      expect(userTabs.some((t) => t.sql.includes("bi-mat"))).toBe(false);
    } finally {
      db2.close();
    }
  }, 20000);
});