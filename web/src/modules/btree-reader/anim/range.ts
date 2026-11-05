import type { BTreeModel, BTreeNode, BTreePath } from "@/contracts/btree";

export type RangeEnd = "done" | "lastLeaf" | "partial" | "unread";
export type RangeError = "badRange" | "badType" | "multiColumn";
export type RangePlan = { error: RangeError } | { slide: BTreeNode[]; end: RangeEnd };

const NUM = /^-?\d+(\.\d+)?$/;
const numeric = (keys: string[]) => keys.length > 0 && keys.every((k) => NUM.test(k)) && keys.every((k, i) => i === 0 || Number(keys[i - 1]) <= Number(k));
const str = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Các leaf kế tiếp cần đọc cho khoảng [path.key, to], đi theo `next`. Chỉ dùng leaf và khóa có trong model.
 * Kiểu khóa suy từ chính các khóa của leaf đầu (model không ghi kiểu): toàn số, đã sắp tăng theo số thì so theo số, còn lại so theo byte.
 * shortcut: index text mà khóa toàn chữ số và vừa lúc sắp đúng theo số thì bị coi là số; sửa khi BTreeModel có kiểu cột.
 */
export function planRange(model: BTreeModel, path: BTreePath, to: string): RangePlan {
  if (model.columns.length > 1) return { error: "multiColumn" };
  const byPage = new Map(model.nodes.map((n) => [n.page, n]));
  const first = byPage.get(path.pages[path.pages.length - 1]);
  const isNum = first ? numeric(first.keys) : NUM.test(path.key) && NUM.test(to);
  if (isNum && !NUM.test(to)) return { error: "badType" };
  const cmp = isNum ? (a: string, b: string) => Math.sign(Number(a) - Number(b)) : str;
  if (cmp(path.key, to) > 0) return { error: "badRange" };
  const slide: BTreeNode[] = [];
  let cur = first;
  let end: RangeEnd = "unread"; // leaf đầu là trang chưa đọc thì không có gì để trượt
  for (let guard = 0; cur && guard < 100_000; guard++) {
    const last = cur.keys[cur.keys.length - 1];
    if (last !== undefined && cmp(last, to) > 0) {
      end = "done";
      break;
    }
    const nxt = cur.next ? byPage.get(cur.next) : undefined;
    // Leaf chỉ giữ một phần khóa: chưa thấy hết khóa của nó, trừ khi khóa đầu của leaf kế đã không vượt quá `to` (khi đó mọi khóa của nó cũng không vượt).
    const complete = cur.keys.length >= cur.totalKeys;
    const certain = complete || (nxt !== undefined && nxt.keys[0] !== undefined && cmp(nxt.keys[0], to) <= 0);
    if (!certain) end = "partial";
    else if (!cur.next) end = "lastLeaf";
    else if (!nxt) end = "unread";
    else {
      slide.push(nxt);
      cur = nxt;
      continue;
    }
    break;
  }
  return { slide, end };
}
