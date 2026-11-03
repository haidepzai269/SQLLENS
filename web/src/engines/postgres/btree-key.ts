// Giải mã khóa index từ hex của bt_page_items. Không gọi hàm xuất của kiểu nào trong database, nên kiểu do người dùng tạo không chạy được dưới quyền quản trị.
const B = BigInt; // tsconfig target < ES2020 không cho viết literal 1n
const [N1000, N1M] = [B(1000), B(1000000)];
const EPOCH_MS = B(946684800000);
const MAX64 = B("9223372036854775807");
const MIN64 = B("-9223372036854775808");

export class Unsupported extends Error {}

export type Kind = "int2" | "int4" | "int8" | "text" | "uuid" | "timestamptz";
// OID cố định của kiểu có sẵn. Domain hay kiểu khác có OID khác, nên rơi vào NotSimulated.
export const KINDS: Record<number, Kind> = { 21: "int2", 23: "int4", 20: "int8", 25: "text", 1043: "text", 2950: "uuid", 1184: "timestamptz" };
const ALIGN: Record<Kind, number> = { int2: 2, int4: 4, int8: 8, text: 4, uuid: 1, timestamptz: 8 };
const SIZE: Partial<Record<Kind, number>> = { int2: 2, int4: 4, int8: 8, uuid: 16, timestamptz: 8 };

export type Val = { text: string; cmp: bigint | string };

const pad2 = (n: number) => String(n).padStart(2, "0");

function timestamptz(us: bigint): Val {
  if (us === MAX64) return { text: "infinity", cmp: us };
  if (us === MIN64) return { text: "-infinity", cmp: us };
  const ms = Number(us / N1000) + 946684800000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Unsupported("timestamp range");
  let frac = String(((us % N1M) + N1M) % N1M).padStart(6, "0").replace(/0+$/, "");
  frac = frac ? "." + frac : "";
  const s = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${frac}+00`;
  return { text: s, cmp: us };
}

/** `hex` dạng "01 00 ..." của bt_page_items. Trả tối đa `natts` giá trị; thiếu dữ liệu thì dừng (khóa bị cắt ở pivot). */
export function decodeKey(hex: string | null, kinds: Kind[], natts: number): Val[] {
  const b = Uint8Array.from((hex ?? "").split(/\s+/).filter(Boolean), (h) => parseInt(h, 16));
  const dv = new DataView(b.buffer);
  const out: Val[] = [];
  let off = 0;
  for (let i = 0; i < Math.min(natts, kinds.length) && off < b.length; i++) {
    const k = kinds[i];
    if (k === "text") {
      if (b[off] === 0) off = (off + 3) & ~3; // byte đệm trước varlena căn 4
      const h = b[off];
      let start: number, len: number;
      if (h === 0x01) throw new Unsupported("toast");
      if (h & 1) {
        len = h >> 1;
        start = off + 1;
        len -= 1;
      } else if ((h & 3) === 0) {
        const total = dv.getUint32(off, true) >>> 2;
        start = off + 4;
        len = total - 4;
      } else throw new Unsupported("compressed");
      if (start + len > b.length) throw new Unsupported("short");
      const bytes = b.subarray(start, start + len);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // So sánh theo byte UTF-8 (đúng với collation C): mã hóa lại thành chuỗi latin1 để so theo thứ tự byte.
      out.push({ text, cmp: String.fromCharCode(...bytes) });
      off = start + len;
      continue;
    }
    off = Math.ceil(off / ALIGN[k]) * ALIGN[k];
    const n = SIZE[k]!;
    if (off + n > b.length) break;
    if (k === "int2") out.push({ text: String(dv.getInt16(off, true)), cmp: BigInt(dv.getInt16(off, true)) });
    else if (k === "int4") out.push({ text: String(dv.getInt32(off, true)), cmp: BigInt(dv.getInt32(off, true)) });
    else if (k === "int8") out.push({ text: String(dv.getBigInt64(off, true)), cmp: dv.getBigInt64(off, true) });
    else if (k === "timestamptz") out.push(timestamptz(dv.getBigInt64(off, true)));
    else {
      const h = [...b.subarray(off, off + 16)].map((x) => x.toString(16).padStart(2, "0")).join("");
      out.push({ text: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, cmp: h });
    }
    off += n;
  }
  return out;
}

/** Đổi chuỗi người dùng nhập thành giá trị so sánh được với khóa cột đầu; undefined nếu không hợp lệ. */
export function parseProbe(kind: Kind, s: string): bigint | string | undefined {
  if (kind === "int2" || kind === "int4" || kind === "int8") {
    if (!/^-?\d{1,19}$/.test(s)) return undefined;
    const v = BigInt(s);
    const lim = { int2: B(2) ** B(15), int4: B(2) ** B(31), int8: B(2) ** B(63) }[kind];
    return v >= -lim && v < lim ? v : undefined;
  }
  if (kind === "uuid") return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s) ? s.replace(/-/g, "").toLowerCase() : undefined;
  if (kind === "timestamptz") {
    if (!/^\d{4}-\d\d-\d\d([T ]\d\d:\d\d(:\d\d(\.\d{1,6})?)?)?(Z|[+-]\d\d(:?\d\d)?)?$/.test(s)) return undefined;
    // Không có múi giờ thì PostgreSQL dùng múi giờ phiên; ở đây không biết nên coi là UTC.
    const iso = s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
    const m = /\.(\d{1,6})/.exec(iso);
    const ms = Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(iso) || !/T/.test(iso) ? iso.replace(/\.\d+/, "") : iso.replace(/\.\d+/, "") + "Z");
    if (Number.isNaN(ms)) return undefined;
    return (BigInt(ms) - EPOCH_MS) * N1000 + BigInt((m?.[1] ?? "").padEnd(6, "0") || "0");
  }
  return String.fromCharCode(...new TextEncoder().encode(s));
}
