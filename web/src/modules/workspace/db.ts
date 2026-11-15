// Mở IndexedDB của workspace. Không fetch, không gửi gì lên server: nháp chỉ nằm trên máy.

export const DB_NAME = "sqllens-workspace";
export const CURRENT_DB_VERSION = 1;

// Tên store và index để repository và test dùng chung một nguồn.
export const STORE_PROJECTS = "projects";
export const STORE_TABS = "tabs";
export const STORE_META = "meta";
export const INDEX_BY_SCOPE = "by_scope";
export const INDEX_BY_PROJECT = "by_project";

export function openWorkspaceDb(factory?: IDBFactory): Promise<IDBDatabase> {
  const idb = factory ?? globalThis.indexedDB;
  if (!idb) return Promise.reject(new Error("IndexedDB không có trong môi trường này"));
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, CURRENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Bản ghi của bản cũ không có gì cần chuyển: version 1 là bản đầu tiên.
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const projects = db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        projects.createIndex(INDEX_BY_SCOPE, "scopeKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TABS)) {
        const tabs = db.createObjectStore(STORE_TABS, { keyPath: "id" });
        tabs.createIndex(INDEX_BY_PROJECT, "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Tab khác đang mở bản mới hơn thì đóng lại và báo rõ, thay vì để lỗi VersionError khó hiểu.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Không mở được IndexedDB của workspace"));
    request.onblocked = () => reject(new Error("IndexedDB đang bị một tab khác giữ, không nâng cấp được"));
  });
}

export function deleteWorkspaceDb(factory?: IDBFactory): Promise<void> {
  const idb = factory ?? globalThis.indexedDB;
  if (!idb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = idb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Không xóa được IndexedDB của workspace"));
    request.onblocked = () => resolve();
  });
}
