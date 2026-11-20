// Dự án cần mở ngay sau khi điều hướng về workspace (hiện dùng cho Fork từ trang /share).
//
// Chỉ ghi id dự án: SQL vẫn nằm nguyên trong IndexedDB, không đi qua storage dạng chuỗi
// và không rời máy người dùng (Core Rule 7).
//
// Mốc thời gian đi kèm để dấu chờ cũ tự hết hạn: workspace boot nhiều lần với các scope khác
// nhau (guest trước, user sau khi /api/me xong), nên dấu chờ KHÔNG được xóa ở lần boot không
// khớp scope — nếu xóa, dự án vừa fork trong scope user sẽ không bao giờ được mở.

const PENDING_PROJECT_KEY = "sqllens:open-project";
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingRecord {
  id: string;
  at: number;
}

function safeSessionStorage(): Storage | null {
  try {
    // Chế độ riêng tư hoặc chính sách trình duyệt có thể ném ngay khi đọc `sessionStorage`.
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readRecord(storage: Storage | null): PendingRecord | null {
  try {
    const raw = storage?.getItem(PENDING_PROJECT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Partial<PendingRecord>;
    if (typeof record.id !== "string" || !record.id || typeof record.at !== "number") return null;
    return { id: record.id, at: record.at };
  } catch {
    return null;
  }
}

export function markPendingProject(
  projectId: string,
  storage: Storage | null = safeSessionStorage(),
  now: number = Date.now(),
): void {
  if (!projectId) return;
  try {
    storage?.setItem(PENDING_PROJECT_KEY, JSON.stringify({ id: projectId, at: now }));
  } catch {
    // Không lưu được thì người dùng vẫn thấy dự án mới ở danh sách, chỉ không tự mở sẵn.
  }
}

/** Đọc dấu chờ mà không xóa; quá hạn thì dọn luôn và trả `null`. */
export function peekPendingProject(
  storage: Storage | null = safeSessionStorage(),
  now: number = Date.now(),
): string | null {
  const record = readRecord(storage);
  if (!record) return null;
  if (now - record.at > PENDING_TTL_MS) {
    clearPendingProject(record.id, storage);
    return null;
  }
  return record.id;
}

/** Chỉ dọn khi đúng dự án vừa mở, để lần boot ở scope khác không xóa mất dấu chờ. */
export function clearPendingProject(
  projectId: string,
  storage: Storage | null = safeSessionStorage(),
): void {
  try {
    const record = readRecord(storage);
    if (record?.id === projectId) storage?.removeItem(PENDING_PROJECT_KEY);
  } catch {
    // storage bị chặn: không có gì để dọn
  }
}

/** Lấy và xóa dấu chờ (dùng cho test và chỗ gọi không cần kiểm scope). */
export function consumePendingProject(storage: Storage | null = safeSessionStorage()): string | null {
  const id = peekPendingProject(storage);
  if (id) clearPendingProject(id, storage);
  return id;
}
