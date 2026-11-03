import { MySQL, PostgreSQL, SQLDialect } from "@codemirror/lang-sql";
import type { EngineId } from "@/contracts/engine";

// PostgreSQL gốc không coi ':' là ký tự toán tử nên `::` không được tô; thêm vào để `::int` là toán tử.
const PG = SQLDialect.define({ ...PostgreSQL.spec, operatorChars: `${PostgreSQL.spec.operatorChars ?? ""}:` });
export const DIALECT: Record<EngineId, SQLDialect> = { postgres: PG, mysql: MySQL };
