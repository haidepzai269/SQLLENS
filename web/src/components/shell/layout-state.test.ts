import { describe, expect, it } from "vitest";
import { clampSize, defaultState, isLastOpen, sanitize, toggleZone } from "./layout-state";

describe("layout-state", () => {
  it("rác thì về mặc định", () => {
    for (const bad of [null, undefined, 5, "x", [], { open: 1, size: "a" }]) expect(sanitize(bad)).toEqual(defaultState());
  });
  it("kích thước bị kẹp trong khoảng, NaN bị bỏ", () => {
    const s = sanitize({ size: { sql: 9999, findings: 1, terminal: NaN } });
    expect(s.size).toEqual({ sql: 560, findings: 260, terminal: 180 });
    expect(clampSize("terminal", 100.4)).toBe(100);
  });
  it("cả bốn vùng tắt thì mở lại hết", () => {
    const off = { sql: false, stage: false, findings: false, terminal: false };
    expect(sanitize({ open: off }).open).toEqual(defaultState().open);
  });
  it("không cho tắt vùng cuối", () => {
    let s = defaultState();
    for (const z of ["sql", "stage", "findings"] as const) s = toggleZone(s, z);
    expect(isLastOpen(s, "terminal")).toBe(true);
    expect(toggleZone(s, "terminal")).toBe(s);
    expect(toggleZone(s, "sql").open.sql).toBe(true);
  });
});
