import type { EngineAdapter, QueryResult } from "@/contracts/engine";

// PGlite chỉ nạp bằng import() động, để mở trang không tải file WASM.
export async function createPostgresAdapter(): Promise<EngineAdapter> {
  const { PGlite } = await import("@electric-sql/pglite");
  // shortcut: chạy trên main thread, nâng lên worker ở STR012.
  // shortcut: role mặc định có quyền cao, đổi sang role quyền thấp ở STR013.
  // Tải tay cả ba file: PGlite 0.5.14 treo mãi, không báo lỗi, khi tải file WASM thất bại.
  const get = async (url: URL) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url.pathname}`);
    return res;
  };
  const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/pglite.wasm", import.meta.url)).then((r) =>
      WebAssembly.compileStreaming(r),
    ),
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/initdb.wasm", import.meta.url)).then((r) =>
      WebAssembly.compileStreaming(r),
    ),
    get(new URL("../../../node_modules/@electric-sql/pglite/dist/pglite.data", import.meta.url)).then((r) => r.blob()),
  ]);
  const db = await PGlite.create({ pgliteWasmModule, initdbWasmModule, fsBundle });
  return {
    engine: "postgres",
    async execute(sql, options) {
      options?.signal?.throwIfAborted();
      const results = await db.exec(sql, { rowMode: "array" });
      return results.map(
        (r): QueryResult => ({
          columns: r.fields.map((f) => f.name),
          rows: r.rows as unknown[][],
          affectedRows: r.affectedRows,
        }),
      );
    },
    // shortcut: chưa làm EXPLAIN, trả NotSimulated đến STR007.
    explain: async () => ({ kind: "not_simulated", reasonKey: "lab.notSimulated.explain" }),
    dispose: () => db.close(),
  };
}
