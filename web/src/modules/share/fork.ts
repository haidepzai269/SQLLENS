// Fork một snapshot chia sẻ thành dự án riêng trong workspace cục bộ.
//
// Toàn bộ snapshot đã nằm trong fragment URL và được giải mã ở máy khách; hàm này chỉ ghi
// vào IndexedDB của chính người nhận, không gọi API và không gửi byte nào lên server
// (Core Rule 7). Trang /share không có AuthProvider nên scope được xác định riêng, một lần,
// đúng lúc người dùng bấm Fork.

import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository, WorkspaceQuotaError } from "@/modules/workspace/repository";
import { markPendingProject } from "@/modules/workspace/pending-project";
import {
  scopeKey,
  type WorkspaceProject,
  type WorkspaceScope,
  type WorkspaceTab,
} from "@/modules/workspace/types";
import type { SnapshotV1 } from "./snapshot";

export type ForkErrorCode = "FORK_STORAGE_UNAVAILABLE" | "FORK_QUOTA_EXCEEDED" | "FORK_FAILED";

export class ForkError extends Error {
  readonly code: ForkErrorCode;

  constructor(code: ForkErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ForkError";
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, ForkError.prototype);
  }
}

export interface ForkOptions {
  factory?: IDBFactory;
  now?: () => number;
  newId?: () => string;
  /** Hậu tố tên dự án, truyền từ bản dịch (` (bản sao)` / ` (fork)`). */
  suffix?: string;
  /** localStorage cho lịch sử fork; test truyền storage giả. */
  storage?: Storage | null;
  /** sessionStorage cho id dự án cần mở sau khi điều hướng. */
  session?: Storage | null;
}

export interface ForkResult {
  projectId: string;
  tabs: number;
}

/** Khóa lưu các dấu vân tay snapshot đã fork, để lần fork thứ hai không im lặng nhân bản. */
export const FORK_HISTORY_KEY = "sqllens:fork-history";

const MAX_REMEMBERED_FORKS = 50;

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Dấu vân tay tất định của snapshot (FNV-1a 32 bit trên JSON).
 *
 * Không dùng mật mã: mục đích chỉ là nhận ra "link này đã fork" trong cùng trình duyệt,
 * không phải chống giả mạo. Không lưu nội dung SQL, chỉ lưu 8 ký tự hex.
 */
export function snapshotFingerprint(snapshot: SnapshotV1): string {
  const text = JSON.stringify(snapshot);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function readForkHistory(storage: Storage | null): string[] {
  try {
    const raw = storage?.getItem(FORK_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function hasForkedSnapshot(fingerprint: string, storage: Storage | null = safeLocalStorage()): boolean {
  return readForkHistory(storage).includes(fingerprint);
}

export function rememberForkedSnapshot(fingerprint: string, storage: Storage | null = safeLocalStorage()): void {
  try {
    const history = readForkHistory(storage).filter((item) => item !== fingerprint);
    history.push(fingerprint);
    storage?.setItem(FORK_HISTORY_KEY, JSON.stringify(history.slice(-MAX_REMEMBERED_FORKS)));
  } catch {
    // localStorage đầy hoặc bị chặn: bỏ qua, chỉ mất lời nhắc "đã fork trước đó".
  }
}

/**
 * Scope của người nhận link. Trang /share cố ý không gọi `/api/me` khi tải (để xem được khi
 * backend tắt), nên chỉ hỏi một lần lúc bấm Fork; lỗi mạng hoặc 401 rơi về `guest`.
 */
export async function resolveWorkspaceScope(fetchImpl: typeof fetch = fetch): Promise<WorkspaceScope> {
  try {
    const res = await fetchImpl("/api/me", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return { kind: "guest" };
    const me = (await res.json()) as { id?: unknown } | null;
    return typeof me?.id === "string" && me.id ? { kind: "user", userId: me.id } : { kind: "guest" };
  } catch {
    return { kind: "guest" };
  }
}

/**
 * Ghi snapshot thành dự án mới trong đúng scope, trong MỘT transaction của IndexedDB:
 * lỗi giữa chừng (hết dung lượng) không để lại dự án nửa vời.
 *
 * Không sửa snapshot trong URL; tabs nhận id mới và giữ nguyên thứ tự, tên, nội dung.
 */
export async function forkSnapshot(
  snapshot: SnapshotV1,
  scope: WorkspaceScope,
  options: ForkOptions = {},
): Promise<ForkResult> {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const at = now();
  const projectId = newId();

  const project: WorkspaceProject = {
    id: projectId,
    scopeKey: scopeKey(scope),
    name: `${snapshot.project.name}${options.suffix ?? " (fork)"}`,
    engine: snapshot.project.engine,
    createdAt: at,
    updatedAt: at,
  };
  const tabs: WorkspaceTab[] = snapshot.tabs.map((tab, index) => ({
    id: newId(),
    projectId,
    name: tab.name,
    sql: tab.sql,
    position: index,
    updatedAt: at,
  }));

  let db: IDBDatabase;
  try {
    db = await openWorkspaceDb(options.factory);
  } catch (err) {
    throw new ForkError("FORK_STORAGE_UNAVAILABLE", "Trình duyệt không cho mở bộ nhớ cục bộ", err);
  }

  try {
    await getRepository(db).putProjectWithTabs(project, tabs);
  } catch (err) {
    if (err instanceof WorkspaceQuotaError) {
      throw new ForkError("FORK_QUOTA_EXCEEDED", "Bộ nhớ trình duyệt đã đầy nên không lưu được dự án", err);
    }
    throw new ForkError("FORK_FAILED", "Không ghi được dự án vào bộ nhớ cục bộ", err);
  } finally {
    try {
      db.close();
    } catch {
      // db có thể đã đóng do lỗi transaction
    }
  }

  rememberForkedSnapshot(snapshotFingerprint(snapshot), options.storage);
  markPendingProject(projectId, options.session);
  return { projectId, tabs: tabs.length };
}
