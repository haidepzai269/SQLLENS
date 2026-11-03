import type { QueryResult } from "@/contracts/engine";
import { types, type PGlite } from "@electric-sql/pglite";
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

// date, timestamp, timestamptz và mảng của chúng: PGlite làm `new Date("infinity")` ra Invalid Date, mất cả dấu. Chuỗi mà JS không đọc được (infinity, -infinity, năm ngoài giới hạn Date) giữ nguyên chữ của PostgreSQL.
const toDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d;
};
const DATE_PARSERS: Record<number, (x: string) => unknown> = {};
for (const [el, arr] of [[types.DATE, 1182], [types.TIMESTAMP, 1115], [types.TIMESTAMPTZ, 1185]] as const) {
  DATE_PARSERS[el] = toDate;
  DATE_PARSERS[arr] = (x) => types.arrayParser(x, toDate, arr);
}

// PGlite cộng dồn `affectedRows` qua các câu trong một lần exec, nên lấy `rowCount` của chính câu đó (từ command tag).
const DML = new Set(["INSERT", "UPDATE", "DELETE", "COPY", "MERGE"]);
const toResults = (rs: { fields: { name: string }[]; rows: unknown[]; command?: string; rowCount?: number }[]): QueryResult[] =>
  rs.map((r) => ({
    columns: r.fields.map((f) => f.name),
    rows: r.rows as unknown[][],
    affectedRows: DML.has(r.command ?? "") ? r.rowCount ?? 0 : r.command === "SELECT" ? undefined : 0,
  }));

/** Gọi sau PGlite.create (đã nạp extension pageinspect). Mọi SQL của người dùng chạy qua `run`. */
export async function createSession(db: PGlite) {
  // Đếm role do người dùng tạo (không tính pg_*) và quyền của USER_ROLE, để bắt trường hợp lên superuser, đổi quyền rồi quay về.
  const countRoles = async () =>
    (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_catalog.pg_roles WHERE rolname NOT LIKE 'pg\\_%'")).rows[0].n;

  await db.exec(`
    CREATE ROLE ${USER_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT NOLOGIN;
    ALTER SCHEMA public OWNER TO ${USER_ROLE};
    CREATE EXTENSION pageinspect;`);
  const sessionUser = (await db.query<{ s: string }>("SELECT session_user AS s")).rows[0].s;
  const roleCount = await countRoles();
  await db.exec(`SET ROLE ${USER_ROLE}`);

  // Lớp hai: SQL động (DO, EXECUTE) qua mặt được parser, nên kiểm lại role sau mỗi lần chạy, kể cả khi lỗi.
  async function intact() {
    const p = (
      await db.query<{ ok: boolean }>(
        `SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolcanlogin)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid) AS ok
         FROM pg_catalog.pg_roles r WHERE r.rolname = $1`,
        [USER_ROLE],
      )
    ).rows[0];
    return !!p?.ok && (await countRoles()) === roleCount;
  }

  async function verify() {
    try {
      const r = (await db.query<{ c: string; s: string }>("SELECT current_user AS c, session_user AS s")).rows[0];
      if (r.c === USER_ROLE && r.s === sessionUser && (await intact())) return;
    } catch (e) {
      // Trong transaction đã hỏng không đọc được role, nhưng cũng không đổi được: ROLLBACK sẽ trả role về trước transaction.
      if ((e as { code?: string }).code === "25P02") return;
    }
    throw new GuardError("guard.escaped", undefined, true);
  }

  /**
   * Kênh quản trị có tham số, cho code đọc cây B-Tree. Chỉ dùng trong code của engine, không đưa ra module giao diện. Chạy dưới superuser rồi trả về USER_ROLE.
   * search_path bị ghim về pg_catalog, pg_temp (pg_temp luôn phải ở cuối, nếu không bảng tạm tên pg_class sẽ che catalog) trong lúc chạy, để hàm hay toán tử người dùng tạo trong public không chen vào câu quản trị. Gọi hàm pageinspect bằng `public.`.
   */
  async function adminSession<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult[]>) => Promise<T>): Promise<T> {
    await db.exec("RESET ROLE");
    try {
      // Trong transaction của người dùng, một lỗi sẽ làm transaction hỏng và SET ROLE bên dưới cũng hỏng theo, nên bọc bằng savepoint. Ngoài transaction, SAVEPOINT báo lỗi và bỏ qua.
      const inTxn = await db.exec("SAVEPOINT sqllens_admin").then(() => true, () => false);
      try {
        const sp = (await db.query<{ s: string }>("SELECT pg_catalog.current_setting('search_path') AS s")).rows[0].s;
        await db.exec("SET search_path = pg_catalog, pg_temp"); // pg_temp để cuối: bảng tạm của người dùng không che được catalog
        const restore = () => db.query("SELECT pg_catalog.set_config('search_path', $1, false)", [sp]);
        let out: T;
        try {
          out = await fn(async (sql, params) =>
            params ? toResults([await db.query(sql, params, { rowMode: "array" })]) : toResults(await db.exec(sql, { rowMode: "array" })),
          );
        } catch (e) {
          if (!inTxn) await restore(); // trong transaction, ROLLBACK TO bên dưới tự trả search_path
          throw e;
        }
        await restore();
        if (inTxn) await db.exec("RELEASE SAVEPOINT sqllens_admin");
        return out;
      } catch (e) {
        if (inTxn) await db.exec("ROLLBACK TO SAVEPOINT sqllens_admin; RELEASE SAVEPOINT sqllens_admin");
        throw e;
      }
    } finally {
      await db.exec(`SET ROLE ${USER_ROLE}`);
    }
  }

  return {
    adminSession,
    async run(sql: string): Promise<QueryResult[]> {
      const g = checkUserSql(sql);
      if (!g.ok) throw new GuardError(g.reasonKey, g.statementIndex);
      let out: QueryResult[];
      try {
        out = toResults(await db.exec(sql, { rowMode: "array", parsers: DATE_PARSERS }));
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
