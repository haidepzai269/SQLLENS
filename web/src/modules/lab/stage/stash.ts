// Hai ô nhập (SQL của lab, câu hỏi của Mentor) dùng chung một `sqlRef` của auth để sống qua vòng đăng nhập.
// Chọn nguồn: lab giữ `sqlRef`; Mentor chỉ ghi câu hỏi qua `askRef` (xem stage.tsx), lab ghép hai chuỗi thành một.
const MARK = "\u0000sqllens/v2:";

export const packStash = (sql: string, ask: string) => (ask.trim() === "" ? sql : MARK + JSON.stringify({ sql, ask }));

export function unpackStash(s: string): { sql: string; ask: string } {
  if (s.startsWith(MARK)) {
    try {
      const v: unknown = JSON.parse(s.slice(MARK.length));
      const o = v as { sql?: unknown; ask?: unknown };
      if (typeof o?.sql === "string" && typeof o.ask === "string") return { sql: o.sql, ask: o.ask };
    } catch {
      /* không phải bản ghép: coi cả chuỗi là SQL */
    }
  }
  return { sql: s, ask: "" };
}
