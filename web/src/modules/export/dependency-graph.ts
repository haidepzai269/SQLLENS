import {
  type DependencyGraph,
  DependencyGraphError,
  type TableSpec,
  type TopoSortResult,
} from "./types";

/**
 * Xây dựng đồ thị phụ thuộc từ danh sách TableSpec.
 * Bảng con có FK trỏ tới bảng cha thì bảng con phụ thuộc vào bảng cha (cha phải tạo trước con).
 * Tự tham chiếu (FK trỏ chính nó) được lưu riêng và bỏ qua khỏi các cạnh liên bảng.
 */
export function buildDependencyGraph(tables: TableSpec[]): DependencyGraph {
  const tableMap = new Map<string, string>(); // lowercase -> canonical original name
  const canonicalNames = new Set<string>();

  // Validation 1: Kiểm tra tên bảng rỗng hoặc trùng lặp (kể cả case-insensitive)
  for (const table of tables) {
    const trimmed = table.name.trim();
    if (!trimmed) {
      throw new DependencyGraphError(
        "duplicate_table_name",
        `Tên bảng không được để trống`,
        { table: table.name },
      );
    }

    const lower = trimmed.toLowerCase();
    if (tableMap.has(lower)) {
      throw new DependencyGraphError(
        "duplicate_table_name",
        `Tên bảng bị trùng lặp hoặc xung đột hoa thường: "${table.name}" (đã có "${tableMap.get(lower)}")`,
        { table: table.name, existing: tableMap.get(lower) },
      );
    }

    tableMap.set(lower, table.name);
    canonicalNames.add(table.name);
  }

  // Danh sách nodes sắp xếp theo thứ tự từ điển tăng dần để đảm bảo tính tất định
  const nodes = [...canonicalNames].sort((a, b) => a.localeCompare(b));

  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};
  const selfReferences: Record<string, TableSpec["foreignKeys"]> = {};

  for (const node of nodes) {
    dependencies[node] = [];
    dependents[node] = [];
    selfReferences[node] = [];
  }

  // Dựng các cạnh phụ thuộc từ FK
  for (const table of tables) {
    const tableName = table.name;
    const fks = table.foreignKeys || [];

    for (const fk of fks) {
      const refTableRaw = fk.refTable?.trim();
      if (!refTableRaw) {
        throw new DependencyGraphError(
          "fk_target_missing",
          `Bảng "${tableName}" có khóa ngoại thiếu bảng tham chiếu`,
          { table: tableName, refTable: fk.refTable },
        );
      }

      // Tra cứu bảng tham chiếu (ưu tiên exact match, fallback case-insensitive)
      let canonicalRefTable: string | undefined;
      if (canonicalNames.has(refTableRaw)) {
        canonicalRefTable = refTableRaw;
      } else {
        const lowerRef = refTableRaw.toLowerCase();
        canonicalRefTable = tableMap.get(lowerRef);
      }

      if (!canonicalRefTable) {
        throw new DependencyGraphError(
          "fk_target_missing",
          `Bảng "${tableName}" có khóa ngoại trỏ tới bảng không tồn tại: "${fk.refTable}"`,
          { table: tableName, refTable: fk.refTable },
        );
      }

      // Tự tham chiếu (FK trỏ chính nó)
      if (canonicalRefTable === tableName) {
        selfReferences[tableName].push(fk);
        continue;
      }

      // Bảng con (tableName) phụ thuộc vào bảng cha (canonicalRefTable)
      if (!dependencies[tableName].includes(canonicalRefTable)) {
        dependencies[tableName].push(canonicalRefTable);
      }
      if (!dependents[canonicalRefTable].includes(tableName)) {
        dependents[canonicalRefTable].push(tableName);
      }
    }
  }

  // Sắp xếp các danh sách kề theo thứ tự từ điển tăng dần để đảm bảo tính tất định
  for (const node of nodes) {
    dependencies[node].sort((a, b) => a.localeCompare(b));
    dependents[node].sort((a, b) => a.localeCompare(b));
  }

  return {
    nodes,
    dependencies,
    dependents,
    selfReferences,
  };
}

/**
 * Thuật toán tìm chu trình đơn (simple cycles) tất định dựa trên DFS với giới hạn index (Johnson-style index bounding).
 * Mỗi chu trình bắt đầu và kết thúc tại đỉnh có thứ tự từ điển nhỏ nhất trong chu trình.
 */
function findCycles(graph: DependencyGraph, candidateNodes: string[]): string[][] {
  const nodes = [...candidateNodes].sort((a, b) => a.localeCompare(b));
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, idx) => nodeIndex.set(n, idx));

  const foundCycles: string[][] = [];
  const cycleSignatures = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    const startNode = nodes[i];
    const path: string[] = [startNode];
    const inPath = new Set<string>([startNode]);

    function dfs(current: string) {
      const neighbors = (graph.dependencies[current] ?? [])
        .filter((nbr) => nodeIndex.has(nbr) && nodeIndex.get(nbr)! >= i)
        .sort((a, b) => a.localeCompare(b));

      for (const nbr of neighbors) {
        if (nbr === startNode && path.length > 1) {
          const cycle = [...path, startNode];
          const sig = cycle.join("->");
          if (!cycleSignatures.has(sig)) {
            cycleSignatures.add(sig);
            foundCycles.push(cycle);
          }
        } else if (!inPath.has(nbr) && nodeIndex.get(nbr)! > i) {
          inPath.add(nbr);
          path.push(nbr);
          dfs(nbr);
          path.pop();
          inPath.delete(nbr);
        }
      }
    }

    dfs(startNode);
  }

  foundCycles.sort((a, b) => {
    const minLen = Math.min(a.length, b.length);
    for (let k = 0; k < minLen; k++) {
      const cmp = a[k].localeCompare(b[k]);
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  });

  return foundCycles;
}

/**
 * Sắp xếp tô-pô (Topological Sort) tất định.
 * Bảng cha (được tham chiếu) đứng trước bảng con (có FK trỏ tới cha).
 * Các bảng cùng bậc (cùng sẵn sàng) được sắp theo thứ tự tên bảng tăng dần (localeCompare).
 * Chu trình được phát hiện và trả về trong cycles.
 */
export function topoSort(graph: DependencyGraph): TopoSortResult {
  const nodes = [...graph.nodes].sort((a, b) => a.localeCompare(b));

  if (nodes.length === 0) {
    return { order: [], cycles: [] };
  }

  // Số lượng bảng cha mà node này phụ thuộc nhưng chưa được đưa vào order
  const unresolvedParents: Record<string, number> = {};
  for (const node of nodes) {
    unresolvedParents[node] = graph.dependencies[node]?.length ?? 0;
  }

  // Hàng đợi các node sẵn sàng (không phụ thuộc bảng nào chưa đưa vào order)
  const readyQueue: string[] = [];
  for (const node of nodes) {
    if (unresolvedParents[node] === 0) {
      readyQueue.push(node);
    }
  }
  readyQueue.sort((a, b) => a.localeCompare(b));

  const order: string[] = [];
  const visited = new Set<string>();

  while (readyQueue.length > 0) {
    const current = readyQueue.shift()!;
    order.push(current);
    visited.add(current);

    const children = graph.dependents[current] ?? [];
    for (const child of children) {
      if (visited.has(child)) continue;

      unresolvedParents[child]--;
      if (unresolvedParents[child] === 0) {
        readyQueue.push(child);
        readyQueue.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  // Nếu tất cả các node đều được xử lý -> đồ thị DAG hoàn hảo
  if (order.length === nodes.length) {
    return { order, cycles: [] };
  }

  // Nếu còn node chưa được xử lý -> có chu trình
  const remainingNodes = nodes.filter((n) => !visited.has(n));
  const cycles = findCycles(graph, remainingNodes);

  return {
    order,
    cycles,
  };
}
