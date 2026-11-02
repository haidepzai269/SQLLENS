import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const hex = (name: string) => {
  const m = css.match(new RegExp(`--${name}: *(#[0-9a-f]{6});`));
  if (!m) throw new Error(`thiếu token --${name}`);
  return m[1];
};
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// AC2: chữ trên nền, tối thiểu 4,5:1. Cặp chữ/nền thật sự gặp trong DESIGN.md.
export const TEXT_PAIRS: [string, string][] = [
  ...["ground", "stage", "surface", "raised"].flatMap((bg) => ["text", "ink2", "dim"].map((fg): [string, string] => [fg, bg])),
  ["lamp-ink", "lamp"],
  ["label-real-foreground", "label-real"],
  ["negative", "surface"],
  ["negative", "stage"],
  ...["broken", "passed", "uncertain"].flatMap((s): [string, string][] => [
    [`severity-${s}-foreground`, `severity-${s}-bg`],
    ["text", `severity-${s}-bg`],
    ["ink2", `severity-${s}-bg`],
  ]),
];

describe("token màu", () => {
  it.each(TEXT_PAIRS)("%s trên %s đạt 4,5:1", (fg, bg) => {
    expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("màu đèn tách khỏi vàng mức độ và đạt 3:1 trên nền để làm viền focus", () => {
    expect(hex("lamp")).not.toBe(hex("severity-uncertain"));
    expect(ratio(hex("lamp"), hex("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("có đủ token nhãn và mức độ theo hợp đồng", () => {
    for (const n of ["label-real", "label-simulated", "label-estimated", "severity-broken", "severity-uncertain", "severity-passed"]) hex(n);
  });

  it("mọi màu hex trong DESIGN.md đều có token trong globals.css (AC1)", () => {
    const md = readFileSync("../DESIGN.md", "utf8");
    const used = new Set(md.match(/#[0-9a-fA-F]{6}\b/g)?.map((h) => h.toLowerCase()));
    const defined = new Set(css.match(/#[0-9a-f]{6}\b/g));
    expect([...used].filter((h) => !defined.has(h))).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});
