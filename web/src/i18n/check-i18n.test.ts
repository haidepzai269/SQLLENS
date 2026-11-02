import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkI18n } from "../../scripts/check-i18n.mjs";

function make(files: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), "i18n-"));
  for (const [f, v] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), JSON.stringify(v));
  }
  return root;
}

describe("check-i18n", () => {
  it("hợp lệ thì không có lỗi", () => {
    const r = make({ "vi/a.json": { x: { y: "a {n}" } }, "en/a.json": { x: { y: "b {n}" } } });
    expect(checkI18n(r)).toEqual([]);
  });
  it("AC3 thiếu key lồng nhau ghi đúng ngôn ngữ, module, key", () => {
    const r = make({ "vi/a.json": { x: { y: "a", z: "b" } }, "en/a.json": { x: { y: "a" } } });
    expect(checkI18n(r)).toEqual(["en a x.z: thiếu key"]);
  });
  it("AC4 thiếu file module", () => {
    const r = make({ "vi/a.json": { x: "a" }, "vi/b.json": { x: "a" }, "en/b.json": { x: "a" } });
    expect(checkI18n(r)).toEqual(["en a: thiếu file module"]);
  });
  it("AC5 giá trị rỗng", () => {
    const r = make({ "vi/a.json": { x: "a" }, "en/a.json": { x: "  " } });
    expect(checkI18n(r)).toEqual(["en a x: giá trị rỗng"]);
  });
  it("AC5 biến khác nhau", () => {
    const r = make({ "vi/a.json": { x: "{count} mục" }, "en/a.json": { x: "{total} items" } });
    expect(checkI18n(r)[0]).toContain("biến khác nhau");
  });
});
