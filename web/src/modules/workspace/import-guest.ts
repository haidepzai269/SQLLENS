// Điều phối nhập dự án và câu lệnh nháp của khách (chưa đăng nhập) vào tài khoản cá nhân.
// Tuyệt đối không gửi bất kỳ API cloud nào (Core Rule 7).
// Bản ghi trong scope guest được bảo toàn 100% (AC2).

import { openWorkspaceDb } from "./db";
import { getRepository, toWorkspaceError, type WorkspaceRepository } from "./repository";
import { scopeKey, type WorkspaceProject, type WorkspaceTab } from "./types";

export interface ImportGuestOptions {
  factory?: IDBFactory;
  db?: IDBDatabase;
  repo?: WorkspaceRepository;
  storage?: Storage;
  sessionStorage?: Storage;
}

const STORAGE_KEY_PREFIX_IMPORTED = "sqllens_guest_imported_";
const STORAGE_KEY_PREFIX_DISMISSED = "sqllens_guest_import_dismissed_";

function getSafeStorage(storageOverride?: Storage): Storage | null {
  if (storageOverride) return storageOverride;
  if (typeof window !== "undefined") {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  return null;
}

function getSafeSessionStorage(storageOverride?: Storage): Storage | null {
  if (storageOverride) return storageOverride;
  if (typeof window !== "undefined") {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
  return null;
}

export function isGuestImportDismissed(userId: string, options?: ImportGuestOptions): boolean {
  if (!userId || typeof userId !== "string") return true;
  const store = getSafeSessionStorage(options?.sessionStorage);
  if (!store) return false;
  try {
    const val = store.getItem(`${STORAGE_KEY_PREFIX_DISMISSED}${userId}`);
    return val === "1" || val === "true";
  } catch {
    return false;
  }
}

export function dismissGuestImport(userId: string, options?: ImportGuestOptions): void {
  if (!userId || typeof userId !== "string") return;
  const store = getSafeSessionStorage(options?.sessionStorage);
  if (!store) return;
  try {
    store.setItem(`${STORAGE_KEY_PREFIX_DISMISSED}${userId}`, "1");
  } catch {
    // Trình duyệt chặn cookie/storage trong private browsing
  }
}

export function isGuestImportedForUser(userId: string, options?: ImportGuestOptions): boolean {
  if (!userId || typeof userId !== "string") return false;
  const store = getSafeStorage(options?.storage);
  if (!store) return false;
  try {
    const val = store.getItem(`${STORAGE_KEY_PREFIX_IMPORTED}${userId}`);
    return val === "1" || val === "true";
  } catch {
    return false;
  }
}

export function markGuestImportedForUser(userId: string, options?: ImportGuestOptions): void {
  if (!userId || typeof userId !== "string") return;
  const store = getSafeStorage(options?.storage);
  if (!store) return;
  try {
    store.setItem(`${STORAGE_KEY_PREFIX_IMPORTED}${userId}`, "1");
  } catch {
    // Trình duyệt chặn cookie/storage trong private browsing
  }
}

/**
 * Kiểm tra xem scope guest có nháp thực sự không.
 * Điều kiện:
 * - Có nhiều hơn 1 project, HOẶC
 * - Có ít nhất 1 tab mà `sql.trim().length > 0`, HOẶC
 * - Tổng số tab > 1.
 * Trả về false nếu không có nháp, hoặc nếu IndexedDB bị chặn trong private browsing.
 */
export async function hasGuestDrafts(options?: ImportGuestOptions): Promise<boolean> {
  let db: IDBDatabase | null = null;
  const isExternalDb = Boolean(options?.db);

  try {
    db = options?.db ?? (await openWorkspaceDb(options?.factory));
    const repo = options?.repo ?? getRepository(db);
    const guestProjects = await repo.listProjects({ kind: "guest" });

    if (guestProjects.length === 0) return false;
    if (guestProjects.length > 1) return true;

    // Chỉ có đúng 1 project: kiểm tra các tab của nó
    const tabs = await repo.listTabs(guestProjects[0].id);
    if (tabs.length === 0) return false;
    if (tabs.length > 1) return true;

    // Có đúng 1 tab: kiểm tra xem có nội dung SQL thực không
    return tabs[0].sql.trim().length > 0;
  } catch {
    // IndexedDB bị chặn trong private browsing hoặc lỗi mở DB -> coi như không có nháp
    return false;
  } finally {
    if (!isExternalDb && db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

// In-flight deduplication để chống bấm đúp khi đang import
const inFlightImports = new Map<string, Promise<{ projects: number; tabs: number }>>();

/**
 * Nhân bản toàn bộ projects và tabs từ scope guest sang scope user_<userId>.
 * - Cấp id (UUID) mới cho project và tab.
 * - Trỏ tab sang projectId mới.
 * - Bảo toàn 100% dữ liệu gốc trong scope guest (AC2).
 * - Nếu đã import cho user này rồi: trả về { projects: 0, tabs: 0 } (AC5).
 * - Ghi cờ markGuestImportedForUser sau khi hoàn tất.
 */
export async function importGuestDrafts(
  userId: string,
  options?: ImportGuestOptions,
): Promise<{ projects: number; tabs: number }> {
  if (!userId || typeof userId !== "string") {
    return { projects: 0, tabs: 0 };
  }

  // Chống lặp (AC5): đã import trước đó thì bỏ qua
  if (isGuestImportedForUser(userId, options)) {
    return { projects: 0, tabs: 0 };
  }

  // In-flight protection chống race condition khi người dùng click liên tiếp
  const existing = inFlightImports.get(userId);
  if (existing) {
    return existing;
  }

  const execution = (async () => {
    let db: IDBDatabase | null = null;
    const isExternalDb = Boolean(options?.db);

    try {
      db = options?.db ?? (await openWorkspaceDb(options?.factory));
      const repo = options?.repo ?? getRepository(db);

      const guestProjects = await repo.listProjects({ kind: "guest" });
      if (guestProjects.length === 0) {
        // Không có gì để nhập thì KHÔNG ghi cờ: nháp guest tạo sau này vẫn phải nhập được.
        return { projects: 0, tabs: 0 };
      }

      const now = Date.now();
      const targetScopeKey = scopeKey({ kind: "user", userId });
      let importedProjectsCount = 0;
      let importedTabsCount = 0;
      // Project đã ghi trong lượt này, để dọn lại nếu giữa đường lỗi (quota).
      const createdProjectIds: string[] = [];

      try {
        for (const [index, guestProject] of guestProjects.entries()) {
          const guestTabs = await repo.listTabs(guestProject.id);
          // Mỗi project lệch một mili-giây để `listProjects` (sort theo createdAt) giữ đúng
          // thứ tự guest; cùng một mốc thì thứ tự rơi vào id ngẫu nhiên.
          const stamp = now + index;

          const newProjectId = crypto.randomUUID();
          const newProject: WorkspaceProject = {
            id: newProjectId,
            scopeKey: targetScopeKey,
            name: guestProject.name,
            engine: guestProject.engine,
            createdAt: stamp,
            updatedAt: stamp,
          };

          // Lưu project mới vào scope user
          await repo.upsertProject(newProject);
          createdProjectIds.push(newProjectId);
          importedProjectsCount++;

          // Nhân bản từng tab của project đó
          for (const guestTab of guestTabs) {
            const newTabId = crypto.randomUUID();
            const newTab: WorkspaceTab = {
              id: newTabId,
              projectId: newProjectId,
              name: guestTab.name,
              sql: guestTab.sql,
              position: guestTab.position,
              updatedAt: stamp,
            };
            await repo.upsertTab(newTab);
            importedTabsCount++;
          }
        }
      } catch (err) {
        // Ghi dở dang thì dọn những gì đã ghi ở lượt này, nếu không lần thử lại sẽ
        // nhân đôi đúng những project đã vào trước khi lỗi.
        for (const projectId of createdProjectIds) {
          await repo.deleteProjectCascade(projectId).catch(() => undefined);
        }
        throw toWorkspaceError(err);
      }

      // Đánh dấu đã nhập thành công vào cờ lưu trữ
      markGuestImportedForUser(userId, options);

      return { projects: importedProjectsCount, tabs: importedTabsCount };
    } catch (err) {
      throw toWorkspaceError(err);
    } finally {
      if (!isExternalDb && db) {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
    }
  })();

  inFlightImports.set(userId, execution);
  try {
    return await execution;
  } finally {
    inFlightImports.delete(userId);
  }
}
