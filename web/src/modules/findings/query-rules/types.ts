// Dạng chung của hai engine: adapter pg.ts và mysql.ts đưa AST về đây, luật ở index.ts không rẽ theo engine.
export type Rec = Record<string, unknown>;
export const rec = (x: unknown): Rec | undefined => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Rec) : undefined);
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const text = (x: unknown) => (typeof x === "string" && x ? x : undefined);

// pos: vị trí byte trong SQL gốc (chỉ PostgreSQL có), index.ts đổi sang chỉ số ký tự.
export type X =
  | { k: "col"; q?: string; name: string; pos?: number }
  | { k: "fn"; name: string; args: X[]; pos?: number }
  | { k: "str" | "num"; v: string }
  | { k: "other" };

// top: đi tới được chỉ bằng AND từ gốc điều kiện, nên bắt buộc đúng. Dưới OR thì không.
export type Pred = { k: "cmp"; op: string; l: X; r: X; top: boolean } | { k: "like"; l: X; r: X; top: boolean };
// name rỗng là nguồn không biết cột (subquery, CTE): cột của nó không gán được cho bảng thật.
export type Source = { name?: string; alias?: string };
export type Scope = { sources: Source[]; preds: Pred[] };

export type Cat = "number" | "text" | "other";
export type Index = { parts: { key: string | null; col?: string }[]; btree: boolean };
export type Table = { declared: boolean; cols: Map<string, Cat>; indexes: Index[] };
export type Schema = Map<string, Table>;
export type Adapter = { schema(ast: unknown, into: Schema): void; scopes(ast: unknown): Scope[] };

export const lc = (s: string) => s.toLowerCase();

export function table(schema: Schema, name: string, declared = false): Table {
  let t = schema.get(name);
  if (!t) schema.set(name, (t = { declared: false, cols: new Map(), indexes: [] }));
  if (declared) t.declared = true;
  return t;
}

// Khóa so sánh biểu thức: `lower(email)` trong index và trong WHERE ra cùng khóa. null là không so được.
export function key(x: X): string | null {
  if (x.k === "col") return lc(x.name);
  if (x.k === "str") return `'${x.v}'`;
  if (x.k === "num") return x.v;
  if (x.k !== "fn") return null;
  const a = x.args.map(key);
  return a.includes(null) ? null : `${x.name}(${a.join(",")})`;
}

export function colsIn(x: X): Extract<X, { k: "col" }>[] {
  return x.k === "col" ? [x] : x.k === "fn" ? x.args.flatMap(colsIn) : [];
}

export const part = (x: X) => ({ key: key(x), col: x.k === "col" ? lc(x.name) : undefined });

// Mọi nút lồng nhau, để tìm select/update/delete ở bất cứ độ sâu nào (subquery, CTE, UNION).
export function walk(n: unknown, f: (r: Rec) => void) {
  if (Array.isArray(n)) return n.forEach((c) => walk(c, f));
  const r = rec(n);
  if (!r) return;
  f(r);
  Object.values(r).forEach((c) => walk(c, f));
}
