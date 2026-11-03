import type { QueryResult } from "@/contracts/engine";
import type { PGlite } from "@electric-sql/pglite";
import { checkUserSql, type GuardReason } from "./guard";

export const USER_ROLE = "sqllens_user";

/** Lỗi do lớp bảo vệ. `rebuild` là true khi phiên đã bị đổi role và phải dựng lại. */
export class GuardError extends Error {
  constructor(
    readonly reasonKey: GuardReason,
    readonly statementIndex?: number,
    readonly rebuild = false,
  ) {
    super(statementIndex ? `Statement ${statementIndex} blocked (${reasonKey})` : `Session role changed (${reasonKey})`);
  }
}

const toResults = (rs: Awaited<ReturnType<PGlite["exec"]>>): QueryResult[] =>
  rs.map((r) => ({ columns: r.fields.map((f) => f.name), rows: r.rows as unknown[][], affectedRows: r.affectedRows }));

/** Gọi sau PGlite.create (đã nạp extension pageinspect). Mọi SQL của người dùng chạy qua `run`. */
export async function createSession(db: PGlite) {
  await db.exec(`
    CREATE ROLE ${USER_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT NOLOGIN;
    ALTER SCHEMA public OWNER TO ${USER_ROLE};
    CREATE EXTENSION pageinspect;`);
  const sessionUser = (await db.query<{ s: string }>("SELECT session_user AS s")).rows[0].s;
  await db.exec(`SET ROLE ${USER_ROLE}`);

  // Lớp hai: SQL động (DO, EXECUTE) qua mặt được parser, nên kiểm lại role sau mỗi lần chạy, kể cả khi lỗi.
  async function verify() {
    try {
      const r = (await db.query<{ c: string; s: string }>("SELECT current_user AS c, session_user AS s")).rows[0];
      if (r.c === USER_ROLE && r.s === sessionUser) return;
    } catch (e) {
      // Trong transaction đã hỏng không đọc được role, nhưng cũng không đổi được: ROLLBACK sẽ trả role về trước transaction.
      if ((e as { code?: string }).code === "25P02") return;
    }
    throw new GuardError("guard.escaped", undefined, true);
  }

  return {
    async run(sql: string): Promise<QueryResult[]> {
      const g = checkUserSql(sql);
      if (!g.ok) throw new GuardError(g.reasonKey, g.statementIndex);
      let out: QueryResult[];
      try {
        out = toResults(await db.exec(sql, { rowMode: "array" }));
      } catch (e) {
        await verify();
        throw e;
      }
      await verify();
      return out;
    },
    /** Chỉ dùng trong code của engine, không đưa ra module giao diện. Chạy dưới superuser rồi trả về USER_ROLE. */
    async adminQuery(sql: string): Promise<QueryResult[]> {
      await db.exec("RESET ROLE");
      try {
        return toResults(await db.exec(sql, { rowMode: "array" }));
      } finally {
        await db.exec(`SET ROLE ${USER_ROLE}`);
      }
    },
  };
}
