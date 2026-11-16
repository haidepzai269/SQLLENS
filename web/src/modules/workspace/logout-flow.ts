// Điều phối luồng đăng xuất và dọn dẹp nháp cục bộ của người dùng trên máy dùng chung.
// Tuyệt đối không gọi bất kỳ API cloud nào (Core Rule 7).

import { openWorkspaceDb } from "./db";
import { getRepository, type WorkspaceRepository } from "./repository";
import type { WorkspaceProject, WorkspaceScope } from "./types";

export type LogoutChoice = "delete" | "keep" | "cancel";

export interface PurgeOptions {
  factory?: IDBFactory;
  db?: IDBDatabase;
  repo?: WorkspaceRepository;
}

export interface ConfirmLogoutOptions {
  hasLocalDrafts: boolean;
  prompt?: () => Promise<LogoutChoice>;
}

export class WorkspacePurgeError extends Error {
  readonly code = "WORKSPACE_PURGE_FAILED";
  readonly deletedTabs: number;
  readonly remainingTabs: number;

  constructor(message: string, deletedTabs: number, remainingTabs: number, cause?: unknown) {
    super(message);
    this.name = "WorkspacePurgeError";
    this.deletedTabs = deletedTabs;
    this.remainingTabs = remainingTabs;
    this.cause = cause;
  }
}

// In-flight protection để chống bấm đúp khi đang dọn dẹp scope
const inFlightPurges = new Map<string, Promise<number>>();

/**
 * Kiểm tra xem người dùng có dự án hoặc tab nháp nào lưu trên máy không.
 * Nếu không có IndexedDB (Private mode) hoặc không có nháp, trả về false.
 */
export async function hasUserLocalDrafts(
  userId: string,
  options?: PurgeOptions,
): Promise<boolean> {
  if (!userId || typeof userId !== "string") return false;

  let db: IDBDatabase | null = null;
  const isExternalDb = Boolean(options?.db);

  try {
    db = options?.db ?? (await openWorkspaceDb(options?.factory));
    const repo = options?.repo ?? getRepository(db);
    const scope: WorkspaceScope = { kind: "user", userId };
    const projects = await repo.listProjects(scope);

    if (projects.length === 0) return false;

    // Kiểm tra xem có ít nhất 1 tab nào không
    for (const project of projects) {
      const tabCount = await repo.countTabs(project.id);
      if (tabCount > 0) return true;
    }

    // Nếu có project record nhưng tabCount === 0 (ca hiếm), bản thân project vẫn là nháp cục bộ
    return projects.length > 0;
  } catch {
    // IndexedDB bị chặn trong private browsing hoặc lỗi mở DB -> coi như không có nháp
    return false;
  } finally {
    if (!isExternalDb && db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Xóa toàn bộ dự án và tab thuộc scope user_<userId>.
 * Tuyệt đối không đụng vào scope guest (AC2).
 * Trả về tổng số tab đã bị xóa.
 * Nếu có lỗi giữa chừng, ném WorkspacePurgeError kèm deletedTabs và remainingTabs.
 */
export async function purgeUserScope(
  userId: string,
  options?: PurgeOptions,
): Promise<number> {
  if (!userId || typeof userId !== "string") return 0;

  // Chống bấm đúp (in-flight deduplication)
  const existing = inFlightPurges.get(userId);
  if (existing) {
    return existing;
  }

  const execution = (async () => {
    let db: IDBDatabase | null = null;
    const isExternalDb = Boolean(options?.db);

    try {
      db = options?.db ?? (await openWorkspaceDb(options?.factory));
      const repo = options?.repo ?? getRepository(db);
      const scope: WorkspaceScope = { kind: "user", userId };
      const projects = await repo.listProjects(scope);

      if (projects.length === 0) return 0;

      // Đếm số tab của từng project trước khi xóa
      const projectWithCounts: { project: WorkspaceProject; tabCount: number }[] = [];
      for (const project of projects) {
        const tabCount = await repo.countTabs(project.id);
        projectWithCounts.push({ project, tabCount });
      }

      const totalTabs = projectWithCounts.reduce((acc, p) => acc + p.tabCount, 0);
      let deletedTabs = 0;

      for (let i = 0; i < projectWithCounts.length; i++) {
        const { project, tabCount } = projectWithCounts[i];
        try {
          await repo.deleteProjectCascade(project.id);
          deletedTabs += tabCount;
        } catch (err) {
          const remainingTabs = totalTabs - deletedTabs;
          throw new WorkspacePurgeError(
            `Không thể xóa hoàn toàn dự án "${project.name}": ${err instanceof Error ? err.message : String(err)}`,
            deletedTabs,
            remainingTabs,
            err,
          );
        }
      }

      return deletedTabs;
    } finally {
      if (!isExternalDb && db) {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
    }
  })();

  inFlightPurges.set(userId, execution);
  try {
    return await execution;
  } finally {
    inFlightPurges.delete(userId);
  }
}

/**
 * Hợp đồng xác nhận đăng xuất:
 * - Nếu không có nháp cục bộ: trả về "keep" ngay lập tức (không hiện popup).
 * - Nếu có nháp cục bộ: gọi hàm prompt() để người dùng lựa chọn, mặc định trả về "delete" nếu không có prompt.
 */
export async function confirmLogout({
  hasLocalDrafts,
  prompt,
}: ConfirmLogoutOptions): Promise<LogoutChoice> {
  if (!hasLocalDrafts) {
    return "keep";
  }
  if (!prompt) {
    return "delete";
  }
  return prompt();
}
