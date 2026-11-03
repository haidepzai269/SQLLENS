import { describe, expect, it } from "vitest";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
import { autoLayout, cardHeight, CARD_W, GAP, relations, separate } from "./layout";

const col = (name: string, o: Partial<TableInfo["columns"][number]> = {}) => ({ name, type: "int", nullable: false, isPrimaryKey: false, isUnique: false, ...o });
const T = (name: string, columns: TableInfo["columns"]): TableInfo => ({ schema: "public", name, columns });
const tables = [
  T("users", [col("id", { isPrimaryKey: true })]),
  T("orders", [col("id", { isPrimaryKey: true }), col("user_id", { references: { table: "users", column: "id" } })]),
  T("items", [col("order_id", { references: { table: "orders", column: "id" } }), col("ghost", { references: { table: "nope", column: "id" } })]),
];
const overlaps = (t: TableInfo[], pos: Record<string, { x: number; y: number }>) =>
  t.some((a, i) => t.some((b, j) => {
    if (j <= i) return false;
    const [pa, pb] = [pos[`public.${a.name}`], pos[`public.${b.name}`]];
    return pa.x < pb.x + CARD_W && pb.x < pa.x + CARD_W && pa.y < pb.y + cardHeight(b, false) && pb.y < pa.y + cardHeight(a, false);
  }));

describe("schema-diagram layout", () => {
  it("quan hệ: cạnh đúng cột, FK tới bảng lạ vào missing, FK tự trỏ giữ lại", () => {
    const r = relations([...tables, T("tree", [col("id"), col("parent", { references: { table: "tree", column: "id" } })])]);
    expect(r.edges.map((e) => [e.source, e.sourceCol, e.target, e.targetCol])).toContainEqual(["public.orders", "user_id", "public.users", "id"]);
    expect(r.edges.some((e) => e.source === e.target)).toBe(true);
    expect(r.missing).toEqual([{ from: "items", column: "ghost", table: "nope" }]);
  });
  it("bố cục rộng và hẹp không chồng; hẹp một cột", () => {
    expect(overlaps(tables, autoLayout(tables, false, false))).toBe(false);
    const n = autoLayout(tables, true, false);
    expect(overlaps(tables, n)).toBe(false);
    expect(new Set(Object.values(n).map((p) => p.x))).toEqual(new Set([0]));
  });
  it("0 bảng và bảng không cột", () => {
    expect(autoLayout([], false, false)).toEqual({});
    const e = [T("a", []), T("b", [])];
    expect(overlaps(e, autoLayout(e, false, false))).toBe(false);
  });
  it("separate đẩy thẻ chồng ra cách tối thiểu GAP, thẻ xa thì giữ nguyên", () => {
    const o = { x: 0, y: 0, w: 100, h: 100 };
    const p = separate({ x: 50, y: 10, w: 100, h: 100 }, [o]);
    const gap = Math.max(p.x - (o.x + o.w), o.x - (p.x + 100), p.y - (o.y + o.h), o.y - (p.y + 100));
    expect(gap).toBeGreaterThanOrEqual(GAP);
    expect(separate({ x: 300, y: 0, w: 100, h: 100 }, [o])).toEqual({ x: 300, y: 0 });
  });
});
