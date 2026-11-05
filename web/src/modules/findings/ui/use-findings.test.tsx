import { act, renderHook, waitFor } from "@testing-library/react";
import { loadModule, parseSync } from "pgsql-parser";
import { beforeAll, describe, expect, it } from "vitest";
import type { Outcome } from "@/contracts/conclusion";
import type { Plan } from "@/contracts/plan";
import { parsePostgres, type PgParser } from "@/modules/sql-intake/parser/core";
import { useFindings, type FindingsRun } from "./use-findings";

const SQL =
  "CREATE TABLE users (id int PRIMARY KEY, email text); CREATE INDEX ie ON users (email); " +
  "SELECT * FROM users WHERE email LIKE '%77'; UPDATE users SET id = id WHERE email LIKE '%1'";
const SELECT = "SELECT * FROM users WHERE email LIKE '%77'";
const none: Outcome<Plan> = { kind: "not_simulated", reasonKey: "plan.x" };
const parse = (sql: string) => {
  const r = parsePostgres(sql, parseSync as unknown as PgParser);
  if (!r.ok) throw new Error(r.error.message);
  return r.statements;
};
const run = (id: number, sql: string, o: Partial<FindingsRun> = {}): FindingsRun => ({ id, engine: "postgres", sql, srcSql: sql, statements: parse(sql), explain: async () => none, ...o });

beforeAll(() => loadModule());

describe("useFindings", () => {
  it("không parse được thì no_parse, không đoán", async () => {
    const { result } = renderHook(() => useFindings(run(1, SQL, { statements: undefined })));
    await waitFor(() => expect(result.current).toEqual({ kind: "no_parse" }));
  });

  it("AC6: câu trả về muộn của lần chạy cũ không ghi đè lần mới, và lần mới không hiện kết quả cũ", async () => {
    let release!: (o: Outcome<Plan>) => void;
    const slow = new Promise<Outcome<Plan>>((r) => (release = r));
    const { result, rerender } = renderHook(({ r }) => useFindings(r), { initialProps: { r: run(1, SQL, { explain: () => slow }) } });
    expect(result.current).toBeNull(); // lần 1 đang chờ explain
    rerender({ r: run(2, "CREATE TABLE b (id int PRIMARY KEY)") });
    expect(result.current).toBeNull(); // lần 2 đang kiểm, không mượn kết quả của lần 1
    await waitFor(() => expect(result.current).toEqual({ kind: "ok", items: [] }));
    await act(async () => release(none)); // lần 1 trả lời muộn
    expect(result.current).toEqual({ kind: "ok", items: [] });
  });

  it("explain chỉ chạy một lần cho câu SELECT có luật khớp; câu ghi dữ liệu không bị explain", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useFindings(run(1, SQL, { explain: async (s) => (calls.push(s), none) })));
    await waitFor(() => expect(result.current?.kind).toBe("ok"));
    expect(calls).toEqual([SELECT]);
    const items = result.current?.kind === "ok" ? result.current.items : [];
    expect(items.map((i) => i.outcome)).toEqual([
      { kind: "not_simulated", reasonKey: "plan.x" }, // SELECT: plan NotSimulated đi thẳng ra
      { kind: "not_simulated", reasonKey: "findings.notSimulated.noPlan" }, // UPDATE: không có plan
    ]);
  });

  it("explain lỗi thì chỉ rủi ro của câu đó là chưa mô phỏng được", async () => {
    const { result } = renderHook(() => useFindings(run(1, SQL, { explain: () => Promise.reject(new Error("boom")) })));
    await waitFor(() => expect(result.current?.kind).toBe("ok"));
    const items = result.current?.kind === "ok" ? result.current.items : [];
    expect(items[0].outcome).toEqual({ kind: "not_simulated", reasonKey: "findingsUi.explainError" });
  });
});
