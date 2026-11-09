import type { BTreeModel, BTreeNode, BTreePath } from "@/contracts/btree";
import type { Outcome } from "@/contracts/conclusion";
import type { QueryResult } from "@/contracts/engine";

export type ColumnMeta = {
  name: string;
  type: string;
  isPk: boolean;
};

export type IndexMeta = {
  name: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
  isPk: boolean;
};

export type TableStats = {
  nLeafPages?: number;
  size?: number;
};

export type BuildOptions = {
  probeKey?: string;
  maxNodes?: number;
  isCovering?: boolean;
  pageOffset?: number;
  maxLeafKeys?: number;
  maxChildren?: number;
};

const MAX_LEAF_KEYS_DEFAULT = 4;
const MAX_CHILDREN_DEFAULT = 3;

/** Quote identifier MySQL an toàn */
export function quoteId(id: string): string {
  return `\`${id.replace(/`/g, "``")}\``;
}

/** So sánh hai giá trị khóa: số so theo số, chuỗi so theo locale */
export function compareKeys(a: string, b: string): number {
  const isNumA = /^-?\d+(\.\d+)?$/.test(a);
  const isNumB = /^-?\d+(\.\d+)?$/.test(b);
  if (isNumA && isNumB) {
    return Number(a) - Number(b);
  }
  return a.localeCompare(b);
}

/** Lấy khóa đại diện nhỏ nhất của một node (đệ quy xuống con đầu tiên cho đến leaf) */
function getMinKey(node: BTreeNode, byPage: Map<number, BTreeNode>): string {
  let cur: BTreeNode | undefined = node;
  while (cur && cur.level > 0 && cur.children && cur.children.length > 0) {
    cur = byPage.get(cur.children[0]);
  }
  return cur?.keys[0] ?? "";
}

/**
 * Tìm đường đi từ root xuống leaf cho một khóa trong cây B-Tree
 */
export function findBTreePath(model: BTreeModel, probeKey: string): { pages: number[]; found: boolean; leafPage: number; leafRow?: Record<string, unknown> } {
  if (model.nodes.length === 0) {
    return { pages: [], found: false, leafPage: 0 };
  }
  const byPage = new Map(model.nodes.map((n) => [n.page, n]));
  const pages: number[] = [model.rootPage];
  let cur = byPage.get(model.rootPage);

  while (cur && cur.level > 0 && cur.children && cur.children.length > 0) {
    const keys = cur.keys;
    const children = cur.children;
    let targetIdx = 0;

    // Quy ước B+Tree SQLLens:
    // keys[0] = "" (-inf), children[0]: < keys[1]
    // keys[i] (i >= 1): >= keys[i] và < keys[i+1]
    for (let i = 1; i < keys.length; i++) {
      if (compareKeys(probeKey, keys[i]) >= 0) {
        targetIdx = i;
      } else {
        break;
      }
    }

    const nextChildPage = children[targetIdx] ?? children[0];
    pages.push(nextChildPage);
    cur = byPage.get(nextChildPage);
  }

  const leaf = cur;
  const found = leaf ? leaf.keys.includes(probeKey) : false;
  let leafRow: Record<string, unknown> | undefined;

  if (leaf && leaf.leafRows) {
    const keyIdx = leaf.keys.indexOf(probeKey);
    if (keyIdx >= 0) {
      leafRow = leaf.leafRows[keyIdx];
    }
  }

  return {
    pages,
    found,
    leafPage: leaf ? leaf.page : model.rootPage,
    leafRow,
  };
}

/**
 * Dựng cây B+Tree InnoDB từ dữ liệu mẫu và metadata (pure function, độc lập kết nối DB)
 */
export function buildBTreeFromData(
  tableName: string,
  indexMeta: IndexMeta,
  pkColumns: string[],
  rows: Record<string, unknown>[],
  stats?: TableStats,
  options: BuildOptions = {},
): BTreeModel {
  const maxLeafKeys = options.maxLeafKeys ?? MAX_LEAF_KEYS_DEFAULT;
  const maxChildren = options.maxChildren ?? MAX_CHILDREN_DEFAULT;
  const isPk = indexMeta.isPk || indexMeta.name === "PRIMARY";

  // Sắp xếp dữ liệu theo các cột index (nếu bằng nhau thì theo PK)
  const sorted = [...rows].sort((a, b) => {
    for (const col of indexMeta.columns) {
      const valA = String(a[col] ?? "");
      const valB = String(b[col] ?? "");
      const c = compareKeys(valA, valB);
      if (c !== 0) return c;
    }
    for (const pk of pkColumns) {
      const valA = String(a[pk] ?? "");
      const valB = String(b[pk] ?? "");
      const c = compareKeys(valA, valB);
      if (c !== 0) return c;
    }
    return 0;
  });

  let pageCounter = options.pageOffset ?? (isPk ? 3 : 10);

  // Nếu không có dữ liệu: cây rỗng 1 tầng
  if (sorted.length === 0) {
    const rootPage = pageCounter++;
    const node: BTreeNode = {
      page: rootPage,
      level: 0,
      keys: [],
      totalKeys: 0,
      leafRows: [],
    };
    return {
      engine: "mysql",
      index: indexMeta.name,
      table: tableName,
      columns: indexMeta.columns,
      height: 1,
      rootPage,
      nodes: [node],
      hidden: [],
      totalPages: 1,
      isClustered: isPk,
      pkColumns,
      isCovering: options.isCovering,
    };
  }

  // 1. Dựng tầng Leaf (level 0)
  const leafNodes: BTreeNode[] = [];
  for (let i = 0; i < sorted.length; i += maxLeafKeys) {
    const chunk = sorted.slice(i, i + maxLeafKeys);
    const page = pageCounter++;
    const keys = chunk.map((r) => {
      if (isPk) {
        return String(r[pkColumns[0] ?? indexMeta.columns[0]] ?? "");
      }
      return String(r[indexMeta.columns[0]] ?? "");
    });

    leafNodes.push({
      page,
      level: 0,
      keys,
      totalKeys: keys.length,
      leafRows: chunk,
    });
  }

  // Nối liên kết kép doubly-linked list giữa các leaf page (InnoDB leaf chain)
  for (let i = 0; i < leafNodes.length - 1; i++) {
    leafNodes[i].next = leafNodes[i + 1].page;
  }

  // 2. Dựng các tầng Internal (level 1, 2...)
  const allNodes: BTreeNode[] = [...leafNodes];
  const byPage = new Map<number, BTreeNode>(leafNodes.map((n) => [n.page, n]));
  let currentLevelNodes = leafNodes;
  let currentLevel = 0;

  while (currentLevelNodes.length > 1) {
    const parentLevel = currentLevel + 1;
    const parentNodes: BTreeNode[] = [];

    for (let i = 0; i < currentLevelNodes.length; i += maxChildren) {
      const group = currentLevelNodes.slice(i, i + maxChildren);
      const page = pageCounter++;
      const children = group.map((c) => c.page);

      // Quy ước B+Tree: keys[0] = "" (-inf), keys[i] = minKey của con thứ i
      const keys = group.map((c, idx) => (idx === 0 ? "" : getMinKey(c, byPage)));

      const parentNode: BTreeNode = {
        page,
        level: parentLevel,
        children,
        keys,
        totalKeys: children.length,
      };

      parentNodes.push(parentNode);
      allNodes.push(parentNode);
      byPage.set(page, parentNode);
    }

    currentLevelNodes = parentNodes;
    currentLevel = parentLevel;
  }

  const rootNode = currentLevelNodes[0];
  const rootPage = rootNode.page;
  const height = currentLevel + 1;

  // 3. Đối chiếu thống kê innodb_index_stats
  const totalStatsPages = stats?.size ?? allNodes.length;
  const hidden: { level: number; count: number }[] = [];
  if (totalStatsPages > allNodes.length) {
    hidden.push({ level: 0, count: totalStatsPages - allNodes.length });
  }
  const totalPages = Math.max(allNodes.length, totalStatsPages);

  const model: BTreeModel = {
    engine: "mysql",
    index: indexMeta.name,
    table: tableName,
    columns: indexMeta.columns,
    height,
    rootPage,
    nodes: allNodes,
    hidden,
    totalPages,
    isClustered: isPk,
    pkColumns,
    isCovering: options.isCovering,
  };

  // 4. Nếu là Secondary Index: dựng thêm Clustered Index (PRIMARY) của cùng bảng
  if (!isPk) {
    const primaryIndexMeta: IndexMeta = {
      name: "PRIMARY",
      tableName,
      columns: pkColumns.length ? pkColumns : ["id"],
      isUnique: true,
      isPk: true,
    };
    model.clusteredIndex = buildBTreeFromData(tableName, primaryIndexMeta, pkColumns, rows, stats, {
      ...options,
      pageOffset: 3,
      isCovering: undefined,
    });
  }

  return model;
}

/**
 * Đọc cấu trúc B+Tree InnoDB và đường đi probeKey từ MySQL sandbox
 */
export async function readMysqlBTree(
  exec: (sql: string) => Promise<QueryResult[]>,
  indexName: string,
  options: { probeKey?: string; maxNodes?: number; isCovering?: boolean } = {},
): Promise<{ model: Outcome<BTreeModel>; path?: BTreePath }> {
  try {
    // 1. Đọc metadata của index từ information_schema.STATISTICS
    const [idxRes] = await exec(`
      SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE, INDEX_TYPE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = '${indexName.replace(/'/g, "''")}'
      ORDER BY SEQ_IN_INDEX
    `);

    if (!idxRes || !idxRes.rows.length) {
      return { model: { kind: "not_simulated", reasonKey: "btreeRead.notFound" } };
    }

    const firstRow = idxRes.rows[0];
    const tableName = String(firstRow[0]);
    const isPk = indexName === "PRIMARY";
    const isUnique = Number(firstRow[4]) === 0;
    const columns = idxRes.rows.map((r) => String(r[2]));

    const indexMeta: IndexMeta = {
      name: indexName,
      tableName,
      columns,
      isUnique,
      isPk,
    };

    // 2. Đọc Primary Key của bảng
    const [pkRes] = await exec(`
      SELECT COLUMN_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName.replace(/'/g, "''")}' AND INDEX_NAME = 'PRIMARY'
      ORDER BY SEQ_IN_INDEX
    `);

    const colIdx = pkRes?.columns ? pkRes.columns.indexOf("COLUMN_NAME") : -1;
    let pkColumns = pkRes?.rows ? pkRes.rows.map((r) => String(r[colIdx >= 0 ? colIdx : 0])) : [];
    if (!pkColumns.length) {
      pkColumns = ["id"];
    }

    // 3. Đọc thống kê từ mysql.innodb_index_stats (nếu có quyền)
    let stats: TableStats | undefined;
    try {
      const [statsRes] = await exec(`
        SELECT stat_name, stat_value
        FROM mysql.innodb_index_stats
        WHERE database_name = DATABASE()
          AND table_name = '${tableName.replace(/'/g, "''")}'
          AND index_name = '${indexName.replace(/'/g, "''")}'
      `);
      if (statsRes?.rows?.length) {
        stats = {};
        for (const row of statsRes.rows) {
          const name = String(row[0]);
          const val = Number(row[1]);
          if (name === "n_leaf_pages") stats.nLeafPages = val;
          if (name === "size") stats.size = val;
        }
      }
    } catch {
      // Người dùng không có quyền trên mysql.innodb_index_stats hoặc chưa flush stats: bỏ qua
    }

    // 4. Lấy sample rows từ bảng (tối đa 500 rows, không log SQL người dùng)
    const orderCols = indexMeta.columns.map(quoteId).join(", ");
    const [dataRes] = await exec(`SELECT * FROM ${quoteId(tableName)} ORDER BY ${orderCols} LIMIT 500`);

    const colNames = dataRes?.columns ?? [];
    const rawRows = dataRes?.rows ?? [];
    const rows: Record<string, unknown>[] = rawRows.map((r) => {
      const obj: Record<string, unknown> = {};
      colNames.forEach((name, i) => {
        obj[name] = r[i];
      });
      return obj;
    });

    // 5. Dựng BTreeModel
    const model = buildBTreeFromData(tableName, indexMeta, pkColumns, rows, stats, options);

    // 6. Tính toán đường đi (path)
    let path: BTreePath | undefined;
    if (options.probeKey) {
      const p = findBTreePath(model, options.probeKey);
      path = {
        key: options.probeKey,
        pages: p.pages,
        isCovering: options.isCovering,
      };

      // Nếu là Secondary Index và không phải Covering: tính Bookmark Lookup
      if (!isPk && model.clusteredIndex) {
        let lookupKey: string | undefined;
        if (p.leafRow && pkColumns.length) {
          const pkVal = p.leafRow[pkColumns[0]];
          if (pkVal !== undefined && pkVal !== null) {
            lookupKey = String(pkVal);
          }
        }
        if (!lookupKey && rows.length && pkColumns.length) {
          const fallbackVal = rows[0][pkColumns[0]];
          if (fallbackVal !== undefined && fallbackVal !== null) {
            lookupKey = String(fallbackVal);
          }
        }

        if (lookupKey) {
          path.lookupKey = lookupKey;
          const cp = findBTreePath(model.clusteredIndex, lookupKey);
          path.lookupPages = cp.pages;
        }
      }
    }

    return {
      model: {
        kind: "conclusion",
        label: "simulated",
        data: model,
        evidence: [
          {
            kind: "innodb_stats",
            messageKey: "mysql.btree.evidence",
            values: { pages: model.totalPages, height: model.height },
          },
        ],
      },
      path,
    };
  } catch {
    return { model: { kind: "not_simulated", reasonKey: "btreeRead.notFound" } };
  }
}
