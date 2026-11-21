// Repository của workspace cục bộ: mọi thao tác đọc/ghi IndexedDB đi qua đây.
// Không fetch, không gọi API. Nháp chỉ nằm trên máy người dùng (Core Rule 7).

import { INDEX_BY_PROJECT, INDEX_BY_SCOPE, STORE_PROJECTS, STORE_TABS } from "./db";
import { scopeKey, type WorkspaceProject, type WorkspaceScope, type WorkspaceTab } from "./types";

export class WorkspaceQuotaError extends Error {
  readonly code = "WORKSPACE_QUOTA_EXCEEDED";

  constructor(cause?: unknown) {
    super("Bộ nhớ trình duyệt đã đầy nên không ghi được nháp");
    this.name = "WorkspaceQuotaError";
    this.cause = cause;
  }
}

// Lỗi trình duyệt được dịch sang lỗi của module để chỗ gọi bắt một kiểu duy nhất.
export function toWorkspaceError(err: unknown): Error {
  const name = (err as { name?: string } | null)?.name;
  if (name === "QuotaExceededError") return new WorkspaceQuotaError(err);
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toWorkspaceError(request.error));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toWorkspaceError(tx.error));
    tx.onabort = () => reject(toWorkspaceError(tx.error ?? new Error("Transaction workspace bị hủy")));
  });
}

// Chạy một transaction và chỉ trả kết quả khi transaction đã commit thật,
// nên lỗi quota xuất hiện lúc commit cũng không bị nuốt.
async function runTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = transactionDone(tx);
  try {
    const value = await work(tx);
    await done;
    return value;
  } catch (err) {
    done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction đã abort hoặc đã xong trước đó
    }
    throw toWorkspaceError(err);
  }
}

const byCreatedAt = (a: WorkspaceProject, b: WorkspaceProject) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
const byPosition = (a: WorkspaceTab, b: WorkspaceTab) => a.position - b.position || a.id.localeCompare(b.id);

export interface WorkspaceRepository {
  listProjects(scope: WorkspaceScope): Promise<WorkspaceProject[]>;
  getProject(id: string): Promise<WorkspaceProject | undefined>;
  upsertProject(record: WorkspaceProject): Promise<void>;
  /** Ghi dự án và toàn bộ tab trong một transaction: dùng cho Fork snapshot (Task147). */
  putProjectWithTabs(project: WorkspaceProject, tabs: WorkspaceTab[]): Promise<void>;
  /**
   * Thay toàn bộ tab của một dự án trong một transaction: xóa tab cũ của dự án rồi ghi dự án và
   * tab mới. Dùng khi lấy bản cloud đè lên bản máy (Task154) — hỏng giữa chừng thì IndexedDB
   * rollback, không để lại tab mồ côi.
   */
  replaceProjectTabs(project: WorkspaceProject, tabs: WorkspaceTab[]): Promise<void>;
  deleteProjectCascade(id: string): Promise<void>;
  listTabs(projectId: string): Promise<WorkspaceTab[]>;
  upsertTab(tab: WorkspaceTab): Promise<void>;
  deleteTab(id: string): Promise<void>;
  countTabs(projectId: string): Promise<number>;
}

export function getRepository(db: IDBDatabase): WorkspaceRepository {
  return {
    listProjects(scope) {
      return runTx(db, [STORE_PROJECTS], "readonly", async (tx) => {
        const rows = await requestDone<WorkspaceProject[]>(
          tx.objectStore(STORE_PROJECTS).index(INDEX_BY_SCOPE).getAll(scopeKey(scope)),
        );
        return rows.sort(byCreatedAt);
      });
    },

    getProject(id) {
      return runTx(db, [STORE_PROJECTS], "readonly", (tx) =>
        requestDone<WorkspaceProject | undefined>(tx.objectStore(STORE_PROJECTS).get(id)),
      );
    },

    upsertProject(record) {
      return runTx(db, [STORE_PROJECTS], "readwrite", async (tx) => {
        await requestDone(tx.objectStore(STORE_PROJECTS).put(record));
      });
    },

    // Một transaction cho cả dự án và các tab: lỗi quota giữa chừng sẽ abort toàn bộ,
    // không để lại dự án rỗng hoặc tab mồ côi (Task147 AC: fork không tạo nửa vời).
    putProjectWithTabs(project, tabs) {
      return runTx(db, [STORE_PROJECTS, STORE_TABS], "readwrite", async (tx) => {
        await requestDone(tx.objectStore(STORE_PROJECTS).put(project));
        const store = tx.objectStore(STORE_TABS);
        for (const tab of tabs) await requestDone(store.put(tab));
      });
    },

    // Xóa project và toàn bộ tab của nó trong cùng một transaction.
    // Project không tồn tại vẫn chạy bình thường, chỉ dọn tab mồ côi nếu có.
    deleteProjectCascade(id) {
      return runTx(db, [STORE_PROJECTS, STORE_TABS], "readwrite", async (tx) => {
        const tabs = tx.objectStore(STORE_TABS);
        const keys = await requestDone<IDBValidKey[]>(tabs.index(INDEX_BY_PROJECT).getAllKeys(id));
        for (const key of keys) await requestDone(tabs.delete(key));
        await requestDone(tx.objectStore(STORE_PROJECTS).delete(id));
      });
    },

    // Thay tab của một dự án: xóa hết tab cũ rồi ghi tab mới, cùng transaction với dự án.
    // Không dùng deleteProjectCascade vì dự án phải giữ nguyên id (đang mở trong workspace).
    replaceProjectTabs(project, tabs) {
      return runTx(db, [STORE_PROJECTS, STORE_TABS], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_TABS);
        const keys = await requestDone<IDBValidKey[]>(store.index(INDEX_BY_PROJECT).getAllKeys(project.id));
        for (const key of keys) await requestDone(store.delete(key));
        await requestDone(tx.objectStore(STORE_PROJECTS).put(project));
        for (const tab of tabs) await requestDone(store.put(tab));
      });
    },

    listTabs(projectId) {
      return runTx(db, [STORE_TABS], "readonly", async (tx) => {
        const rows = await requestDone<WorkspaceTab[]>(
          tx.objectStore(STORE_TABS).index(INDEX_BY_PROJECT).getAll(projectId),
        );
        return rows.sort(byPosition);
      });
    },

    upsertTab(tab) {
      return runTx(db, [STORE_TABS], "readwrite", async (tx) => {
        await requestDone(tx.objectStore(STORE_TABS).put(tab));
      });
    },

    deleteTab(id) {
      return runTx(db, [STORE_TABS], "readwrite", async (tx) => {
        await requestDone(tx.objectStore(STORE_TABS).delete(id));
      });
    },

    countTabs(projectId) {
      return runTx(db, [STORE_TABS], "readonly", (tx) =>
        requestDone<number>(tx.objectStore(STORE_TABS).index(INDEX_BY_PROJECT).count(projectId)),
      );
    },
  };
}
