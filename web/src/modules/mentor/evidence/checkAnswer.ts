import type { EvidencePack } from "@/contracts/mentor";

// Giới hạn: chỉ bỏ qua khối ```sql (khối khác vẫn được kiểm số); kiểm số theo giá trị, không theo ngữ cảnh; câu hàm ý ổn chỉ bắt các chủ thể trong danh sách (thiết kế, schema, query, bảng...), không bắt "không thấy vấn đề nào"; chỉ nhận ra phủ định nằm trong 30 ký tự ngay trước cụm "thiết kế ổn", cùng câu,
// kèm động từ nói (nói, kết luận, say...). Khi không chắc thì báo thừa, không bỏ sót.

// Đổi chữ số Unicode (Nd) về ASCII: các khối Nd gồm đúng 10 chữ số liền nhau, đi lùi tới đầu khối để biết giá trị.
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    let k = 0;
    for (let cp = ch.codePointAt(0)! - 1; /^\p{Nd}$/u.test(String.fromCodePoint(cp)); cp--) k++;
    return String(k % 10);
  });
}

// Số dính vào chữ hoặc gạch dưới (orders2) là một phần tên, không phải số.
const NUM = /(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)*/gu;

// Các cách đọc của một token: `1.000` là 1000 hoặc 1, `1,5` là 1,5.
function readings(tok: string): string[] {
  const groups = tok.split(/[.,]/);
  const out = new Set<string>();
  const add = (s: string) => out.add(String(Number(s)));
  if (groups.length === 1) add(tok);
  else {
    add(groups.slice(0, -1).join("") + "." + groups[groups.length - 1]);
    if (groups.slice(1).every((g) => g.length === 3)) add(groups.join(""));
  }
  return [...out];
}

const tokens = (text: string) => asciiDigits(text.normalize("NFKC")).match(NUM) ?? [];

function evidenceNumbers(pack: EvidencePack): Set<string> {
  const known = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) known.add(String(v));
    else if (typeof v === "string") tokens(v).forEach((t) => readings(t).forEach((r) => known.add(r)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(pack);
  return known;
}

// Phủ định phải đứng trước động từ nói, trong cùng mệnh đề (không dấu phẩy, cách động từ nói tối đa 10 ký tự, nên "Không có vấn đề nên tôi nói thiết kế ổn" vẫn bị báo), và khớp nguyên từ.
const W = (alt: string) => String.raw`(?<!\p{L})(?:${alt})(?!\p{L})`;
const NEGATED_SAY = new RegExp(String.raw`${W("chưa|không|đừng|never|cannot|can't|not|don't|won't")}[^.!?,;\n]{0,10}${W("nói|kết luận|khẳng định|hàm ý|say|claim|conclude|state|mean|imply")}`, "iu");
const SUBJ_VI = "thiết kế|schema|query|truy vấn|câu lệnh|bảng|database|cơ sở dữ liệu";
const BANNED = [
  new RegExp(String.raw`${W(SUBJ_VI)}(?: này| của bạn| đó)?(?: đã| khá| rất)? (?:ổn|tốt|hợp lý|chuẩn)(?!\p{L})(?! hơn| định)`, "giu"),
  /\b(?:design|schema|query|table|index|database|setup)(?: is| looks| seems| appears)(?: pretty| quite| very| all)? (?:fine|good|ok|okay|great|solid|sound|well)\b/giu,
  /\blooks (?:good|fine|great)\b/giu,
];

export function checkAnswer(answer: string, pack: EvidencePack): { unknownNumbers: string[]; bannedClaims: string[] } {
  const known = evidenceNumbers(pack);
  const prose = answer.replace(/```sql[\s\S]*?(?:```|$)/gi, " ").replace(/^[ \t]*\d+[.)][ \t]/gm, " ");
  const unknownNumbers = [...new Set(tokens(prose))].filter((t) => !readings(t).some((r) => known.has(r)));

  const text = answer.normalize("NFC");
  const bannedClaims = new Set<string>();
  const taken: [number, number][] = [];
  for (const re of BANNED) {
    for (const m of text.matchAll(re)) {
      const at = m.index;
      const start = Math.max(...[".", "!", "?", "\n"].map((c) => text.lastIndexOf(c, at - 1))) + 1;
      const before = text.slice(Math.max(start, at - 30), at);
      if (NEGATED_SAY.test(before)) continue;
      if (taken.some(([a, b]) => at >= a && at + m[0].length <= b)) continue; // đã nằm trong một cụm bị báo
      taken.push([at, at + m[0].length]);
      bannedClaims.add(m[0]);
    }
  }
  return { unknownNumbers, bannedClaims: [...bannedClaims] };
}
