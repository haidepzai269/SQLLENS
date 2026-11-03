export type CellKind = "null" | "number" | "text" | "date" | "bytes" | "json" | "bool";

const MAX_BYTES = 64;

export function formatCell(value: unknown): { text: string; kind: CellKind } {
  if (value === null || value === undefined) return { text: "NULL", kind: "null" };
  if (typeof value === "boolean") return { text: value ? "t" : "f", kind: "bool" };
  if (typeof value === "number" || typeof value === "bigint") return { text: String(value), kind: "number" };
  if (typeof value === "string") return { text: value, kind: "text" };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { text: "Invalid date", kind: "date" }
      : { text: value.toISOString(), kind: "date" };
  }
  if (value instanceof Uint8Array) {
    const hex = Array.from(value.subarray(0, MAX_BYTES), (b) => b.toString(16).padStart(2, "0")).join("");
    const rest = value.length - MAX_BYTES;
    return { text: `\\x${hex}${rest > 0 ? `… (+${rest} bytes)` : ""}`, kind: "bytes" };
  }
  try {
    const json = JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    return { text: json ?? String(value), kind: "json" };
  } catch {
    return { text: String(value), kind: "text" }; // vòng tham chiếu
  }
}
