import { describe, expect, it } from "vitest";
import type { Plan, PlanNode } from "@/contracts/plan";
import { buildEvidencePack, checkAnswer, MAX_PACK_BYTES, packBytes } from ".";

const node = (id: string, children: PlanNode[] = [], extra: Partial<PlanNode> = {}): PlanNode => ({ id, kind: "seq_scan", label: "Seq Scan", children, ...extra });
const plan = (root: PlanNode): Plan => ({ engine: "postgres", analyzed: true, root });
const deep = (n: number): PlanNode => (n === 0 ? node("leaf") : node(`n${n}`, [deep(n - 1)], { actualRows: 5 }));
const depth = (n: PlanNode): number => 1 + Math.max(0, ...n.children.map(depth));

describe("buildEvidencePack", () => {
  it("AC1: bỏ trường lạ, kể cả lồng sâu", () => {
    const dirty = {
      engine: "postgres", sql: "select 1", rows: [{ email: "a@b.c" }],
      plan: { ...plan(node("a", [node("b", [], { secret: [1] } as never)])), rows: [1] },
    };
    const pack = buildEvidencePack(dirty as never);
    expect(Object.keys(pack).sort()).toEqual(["engine", "plan", "sql"]);
    expect(JSON.stringify(pack)).not.toContain("a@b.c");
    expect(JSON.stringify(pack)).not.toContain("secret");
  });

  it("bằng chứng rỗng", () => {
    expect(buildEvidencePack({ engine: "mysql", sql: "" })).toEqual({ engine: "mysql", sql: "" });
  });

  it("AC2: quá cỡ thì cắt capacity, rồi plan sâu, rồi SQL", () => {
    const capacity = Array.from({ length: 3000 }, (_, i) => ({ rows: i, height: 2, indexBytes: i * 8 }));
    const p = buildEvidencePack({ engine: "postgres", sql: "select 1", plan: plan(deep(5)), capacity });
    expect(p.capacity).toBeUndefined();
    expect(p.plan).toBeDefined();
    expect(p.sqlTruncated).toBeUndefined();

    const p2 = buildEvidencePack({ engine: "postgres", sql: "select 1", plan: plan(deep(3000)) });
    expect(p2.plan && depth(p2.plan.root)).toBeLessThanOrEqual(51);
    expect(p2.sqlTruncated).toBeUndefined();
    expect(packBytes(p2)).toBeLessThanOrEqual(MAX_PACK_BYTES);
  });

  it("AC2: cắt SQL theo byte UTF-8, không cắt giữa cặp đôi", () => {
    for (const unit of ["đ", "😀", "a"]) {
      const sql = unit.repeat(60000);
      const p = buildEvidencePack({ engine: "postgres", sql });
      expect(p.sqlTruncated).toBe(true);
      expect(packBytes(p)).toBeLessThanOrEqual(MAX_PACK_BYTES);
      expect(p.sql.length).toBeGreaterThan(0);
      expect(p.sql).toBe(unit.repeat(Math.round(p.sql.length / unit.length)));
      // nếu thêm một đơn vị nữa thì phải vượt, tức là cắt không quá tay
      expect(packBytes({ ...p, sql: p.sql + unit })).toBeGreaterThan(MAX_PACK_BYTES);
      expect(() => encodeURIComponent(p.sql)).not.toThrow(); // ném URIError nếu còn nửa cặp đôi
    }
  });

  it("AC2: SQL ngắn không bị đánh dấu cắt", () => {
    expect(buildEvidencePack({ engine: "postgres", sql: "😀" }).sqlTruncated).toBeUndefined();
  });

  it("chuỗi dài trong plan cũng bị cắt, gói luôn dưới giới hạn", () => {
    const p = buildEvidencePack({ engine: "postgres", sql: "select 1", plan: plan(node("a", [], { label: "x".repeat(100000), condition: "y".repeat(100000) })) });
    expect(packBytes(p)).toBeLessThanOrEqual(MAX_PACK_BYTES);
    expect(p.sql).toBe("select 1");
    expect(p.sqlTruncated).toBeUndefined();
  });

  it("findings quá lớn vẫn được kéo xuống dưới giới hạn", () => {
    const findings = Array.from({ length: 2000 }, (_, i) => ({ ruleId: "r", messageKey: "k".repeat(100), values: { i } }));
    const p = buildEvidencePack({ engine: "postgres", sql: "select 1", findings });
    expect(packBytes(p)).toBeLessThanOrEqual(MAX_PACK_BYTES);
  });
});

describe("checkAnswer", () => {
  const pack = buildEvidencePack({
    engine: "postgres",
    sql: "select * from orders2 where id = 42",
    plan: plan(node("a", [], { actualRows: 1000, pagesRead: 16 })),
    capacity: [{ rows: 500000, height: 2, indexBytes: 4751360 }],
    findings: [{ ruleId: "r", messageKey: "k", values: { size: 4640, ratio: 1.5 } }],
  });
  const unknown = (a: string) => checkAnswer(a, pack).unknownNumbers;
  const unknownOf = unknown;

  it("AC3: số có trong bằng chứng không bị báo, mọi cách viết", () => {
    expect(unknown("Đọc 1.000 dòng, hay 1,000, hay 1000.")).toEqual([]);
    expect(unknown("Index nặng 4.640 KB.")).toEqual([]);
    expect(unknown("Tỉ lệ 1,5 và 1.5.")).toEqual([]);
    expect(unknown("500.000 dòng, 500,000 rows")).toEqual([]);
  });

  it("AC3: số không có trong bằng chứng bị báo", () => {
    expect(unknown("Cần đọc 73 trang.")).toEqual(["73"]);
    expect(unknown("Giảm 73%")).toEqual(["73"]);
    expect(unknown("Giảm -73")).toEqual(["73"]);
    expect(unknown("2.500 dòng")).toEqual(["2.500"]);
  });

  it("AC4: bỏ qua khối sql, danh sách đánh số, và không trùng lặp", () => {
    expect(unknown("1. Tạo index\n2. Chạy lại\n```sql\nselect 73, 74;\n```\nxong")).toEqual([]);
    expect(unknown("```sql\nselect 99")).toEqual([]); // khối chưa đóng
    expect(unknown("73 rồi lại 73, thêm 74")).toEqual(["73", "74"]);
  });

  it("ca biên: tên bảng, chữ số không phải ASCII, số rất lớn, rỗng", () => {
    expect(unknown("bảng orders2 và t_3")).toEqual([]);
    expect(unknown("id = 42 và ٤٢ và ４２")).toEqual([]);
    expect(unknown("٧٣")).toEqual(["73"]);
    expect(unknown("10000000000000000000000")).toEqual(["10000000000000000000000"]);
    expect(checkAnswer("", pack)).toEqual({ unknownNumbers: [], bannedClaims: [] });
    expect(checkAnswer("73", { engine: "postgres", sql: "" }).unknownNumbers).toEqual(["73"]);
  });

  it("AC5: bắt câu hàm ý thiết kế ổn", () => {
    for (const s of ["Thiết kế này ổn.", "thiết kế tốt rồi", "THIẾT KẾ NÀY ỔN", "This design is fine.", "Looks good to me", "LOOKS GOOD", "Your schema looks great"]) {
      expect(checkAnswer(s, pack).bannedClaims.length, s).toBe(1);
    }
    expect(checkAnswer("Không có lỗi nào nên thiết kế này ổn.", pack).bannedClaims).toHaveLength(1);
  });

  it("AC5: phủ định không đứng trước động từ nói thì vẫn báo", () => {
    for (const s of ["Không thấy lỗi, tôi kết luận thiết kế này ổn.", "Don't worry, I'd say this design is fine.", "Query này ổn rồi.", "Schema ổn.", "Here is a note: the design is fine."])
      expect(checkAnswer(s, pack).bannedClaims.length, s).toBe(1);
    expect(checkAnswer("Thiết kế ổn định hơn, query tốt hơn.", pack).bannedClaims).toEqual([]);
  });

  it("AC4: chỉ khối sql được bỏ qua", () => {
    expect(unknownOf("```text\nGiảm 73 trang\n```")).toEqual(["73"]);
  });

  it("AC5: không báo nhầm câu có phủ định kèm động từ nói", () => {
    for (const s of ["Chưa thể nói thiết kế này ổn.", "Không bao giờ nói thiết kế này ổn.", "We never say this design is fine.", "I cannot say it looks good."]) {
      expect(checkAnswer(s, pack).bannedClaims, s).toEqual([]);
    }
    expect(checkAnswer("Hỏng ở bước 2. Thiết kế này ổn.", pack).bannedClaims).toHaveLength(1); // phủ định ở câu trước không tính
  });
});
