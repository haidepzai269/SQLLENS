// SQL chỉ nằm ở sessionStorage của tab này qua vòng đăng nhập, không lên server, không vào localStorage.
const KEY = "sqllens.sqlStash";
const MAX_AGE = 15 * 60_000;

export function stashSql(sql: string): boolean {
  try {
    if (sql.trim() === "") return true;
    sessionStorage.setItem(KEY, JSON.stringify({ sql, at: Date.now() }));
    return true;
  } catch {
    return false; // bị chặn hoặc đầy
  }
}

// Đọc rồi xóa ngay. Bản quá cũ coi như không có.
export function takeSql(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { sql?: unknown; at?: unknown };
    return typeof v.sql === "string" && typeof v.at === "number" && Date.now() - v.at < MAX_AGE ? v.sql : null;
  } catch {
    return null;
  }
}

export function storageWorks(): boolean {
  try {
    sessionStorage.setItem(`${KEY}.probe`, "1");
    sessionStorage.removeItem(`${KEY}.probe`);
    return true;
  } catch {
    return false;
  }
}
