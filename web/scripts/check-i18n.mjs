// Dùng: node scripts/check-i18n.mjs [thư mục messages]. Thoát 1 nếu bản dịch thiếu, rỗng hoặc lệch biến.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkI18n(root) {
  const errors = [];
  const locales = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const files = (l) => readdirSync(path.join(root, l)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  const modules = [...new Set(locales.flatMap(files))].sort();

  const flatten = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${p}${k}.`) : [[`${p}${k}`, v]],
    );
  // shortcut: lấy tên đầu mỗi cặp ngoặc nhọn, chữ trong nhánh plural cũng bị tính là biến; nâng lên parser ICU khi cần.
  const vars = (s) => [...new Set([...String(s).matchAll(/\{\s*([A-Za-z_]\w*)/g)].map((m) => m[1]))].sort().join(",");

  for (const m of modules) {
    const data = {};
    for (const l of locales) {
      const f = path.join(root, l, `${m}.json`);
      if (!existsSync(f)) {
        errors.push(`${l} ${m}: thiếu file module`);
        continue;
      }
      try {
        data[l] = new Map(flatten(JSON.parse(readFileSync(f, "utf8"))));
      } catch (e) {
        errors.push(`${l} ${m}: JSON lỗi (${e.message})`);
      }
    }
    const keys = [...new Set(Object.values(data).flatMap((d) => [...d.keys()]))].sort();
    for (const k of keys) {
      for (const [l, d] of Object.entries(data)) {
        if (!d.has(k)) errors.push(`${l} ${m} ${k}: thiếu key`);
        else if (typeof d.get(k) !== "string" || d.get(k).trim() === "") errors.push(`${l} ${m} ${k}: giá trị rỗng`);
      }
      const sets = Object.entries(data)
        .filter(([, d]) => typeof d.get(k) === "string")
        .map(([l, d]) => [l, vars(d.get(k))]);
      if (new Set(sets.map(([, v]) => v)).size > 1)
        errors.push(`${m} ${k}: biến khác nhau (${sets.map(([l, v]) => `${l}={${v}}`).join(" ")})`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? "messages");
  const errors = checkI18n(root);
  errors.forEach((e) => console.error(`i18n: ${e}`));
  process.exit(errors.length ? 1 : 0);
}
