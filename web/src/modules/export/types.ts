export interface ColumnSpec {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: string;
  unique?: boolean;
  isIdentity?: boolean;
  comment?: string;
}

export interface ForeignKeySpec {
  name?: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  foreignKeys: ForeignKeySpec[];
  comment?: string;
}

export interface DependencyGraph {
  nodes: string[];
  dependencies: Record<string, string[]>; // table -> parents it depends on (excluding self-references)
  dependents: Record<string, string[]>;   // table -> children depending on it (excluding self-references)
  selfReferences?: Record<string, ForeignKeySpec[]>;
}

export interface TopoSortResult {
  order: string[];
  cycles: string[][];
}

export type DependencyGraphErrorCode = "fk_target_missing" | "duplicate_table_name";

export class DependencyGraphError extends Error {
  readonly code: DependencyGraphErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DependencyGraphErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DependencyGraphError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, DependencyGraphError.prototype);
  }
}
