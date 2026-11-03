import type { Plan, PlanNode } from "@/contracts/plan";

const n = (id: string, kind: PlanNode["kind"], label: string, x: Partial<PlanNode> = {}, children: PlanNode[] = []): PlanNode => ({ id, kind, label, children, ...x });

export const HTML_COND = '<img src=x onerror="window.__xss=1">';

// 5 bước, có Seq Scan lệch lớn và Index Scan lặp 100 lần (ước tính 1 x 100 = thật 100: không lệch).
export const five = (): Plan => ({
  engine: "postgres",
  analyzed: true,
  root: n("1", "limit", "Limit", { estimatedRows: 20, actualRows: 20, pagesRead: 0 }, [
    n("2", "sort", "Sort", { condition: "o.total DESC", estimatedRows: 20, actualRows: 5000, pagesRead: 0 }, [
      n("3", "nested_loop", "Nested Loop", { estimatedRows: 10, actualRows: 100, loops: 1, pagesRead: 0 }, [
        n("4", "seq_scan", "Seq Scan", { table: "orders", condition: "(total > 100)", estimatedRows: 10, actualRows: 5000, loops: 1, pagesRead: 834 }),
        n("5", "index_scan", "Index Scan", { table: "customers", index: "customers_pkey", condition: "(id = o.customer_id)", estimatedRows: 1, actualRows: 100, loops: 100, pagesRead: 300 }),
      ]),
    ]),
  ]),
});

// Kiểu MySQL: chỉ có ước tính, không có số thật.
export const mysql = (): Plan => ({
  engine: "mysql",
  analyzed: false,
  root: n("1", "nested_loop", "Nested loop inner join", { estimatedRows: 40 }, [
    n("2", "seq_scan", "Table scan", { table: "orders", estimatedRows: 1000 }),
    n("3", "index_scan", "Single-row index lookup", { table: "customers", index: "PRIMARY", estimatedRows: 1 }),
  ]),
});

export const single = (): Plan => ({ engine: "postgres", analyzed: true, root: n("1", "seq_scan", "Seq Scan", { table: "t", estimatedRows: 5, actualRows: 0, pagesRead: 1 }) });

export const other = (): Plan => ({ engine: "postgres", analyzed: true, root: n("1", "other", "Gather Merge", { condition: HTML_COND, estimatedRows: 7, actualRows: 7 }) });

export const deep = (depth = 20): Plan => {
  let r = n(`n${depth}`, "seq_scan", "Seq Scan", { table: "t", estimatedRows: 1, actualRows: 1, pagesRead: 1 });
  for (let i = depth - 1; i >= 1; i--) r = n(`n${i}`, i % 2 ? "sort" : "limit", i % 2 ? "Sort" : "Limit", { estimatedRows: 1, actualRows: 1 }, [r]);
  return { engine: "postgres", analyzed: true, root: r };
};

export const FIXTURES = { five, mysql, single, other, deep } as const;
