// Fork các tab của phòng cộng tác sang dự án local độc lập trong IndexedDB (Task167).
//
// Tuân thủ Core Rule 7: 100% nội dung SQL chỉ nằm trong IndexedDB trên máy khách.
// Luồng bấm Fork chỉ gọi duy nhất `/api/me` (qua `resolveWorkspaceScope`) để xác định scope,
// tuyệt đối không gửi nội dung SQL lên mạng.

import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import type { WorkspaceEngine, WorkspaceScope } from "@/modules/workspace/types";
import {
  ForkError,
  forkSnapshot,
  resolveWorkspaceScope,
  type ForkOptions,
  type ForkResult,
} from "@/modules/share/fork";

/** Trần dung lượng JSON UTF-8 tối đa cho một lần fork từ phòng: 512 KB. */
export const ROOM_FORK_MAX_BYTES = 512 * 1024;

/** Số lượng dự án fork từ phòng đang hoạt động tối đa trong một scope. */
export const ROOM_FORK_MAX_ACTIVE = 5;

export interface RoomForkTabInput {
  name: string;
  sql: string;
}

export interface RoomForkInput {
  projectId: string;
  projectName: string;
  engine: WorkspaceEngine;
  tabs: RoomForkTabInput[];
}

export type RoomForkSizeCheck =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number; tabName: string };

export interface RoomForkTooLargeCause {
  bytes: number;
  tabName: string;
}

export interface RoomForkLimitCause {
  active: number;
  max: number;
}

export type RoomForkOptions = ForkOptions & {
  fetchImpl?: typeof fetch;
};

export interface RoomForkResult extends ForkResult {
  activeForks: number;
}

/**
 * Kiểm tra kích thước UTF-8 thật của mảng tab trước khi fork sang IndexedDB.
 * Đo bằng `TextEncoder` (không dùng `.length` ký tự) để xử lý đúng tiếng Việt / Unicode.
 */
export function checkForkSize(tabs: RoomForkTabInput[]): RoomForkSizeCheck {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(JSON.stringify(tabs)).length;
  if (totalBytes <= ROOM_FORK_MAX_BYTES) {
    return { ok: true, bytes: totalBytes };
  }

  let largestTabName = tabs[0]?.name ?? "";
  let largestBytes = -1;
  for (const tab of tabs) {
    const tabBytes = encoder.encode(JSON.stringify(tab)).length;
    if (tabBytes > largestBytes) {
      largestBytes = tabBytes;
      largestTabName = tab.name;
    }
  }

  return { ok: false, bytes: totalBytes, tabName: largestTabName };
}

/**
 * Đếm số dự án được fork từ phòng (`p.roomFork !== undefined`) hiện có trong IndexedDB của scope.
 */
export async function countActiveForks(
  scope: WorkspaceScope,
  options?: { factory?: IDBFactory },
): Promise<number> {
  let db: IDBDatabase;
  try {
    db = await openWorkspaceDb(options?.factory);
  } catch (err) {
    throw new ForkError("FORK_STORAGE_UNAVAILABLE", "Trình duyệt không cho mở bộ nhớ cục bộ", err);
  }

  try {
    const projects = await getRepository(db).listProjects(scope);
    return projects.filter((p) => p.roomFork !== undefined).length;
  } finally {
    try {
      db.close();
    } catch {
      // db có thể đã đóng do lỗi transaction
    }
  }
}

function formatForkTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Fork toàn bộ tab hiện tại của phòng sang một dự án local mới trong IndexedDB:
 * 1. Kiểm trần 512 KB theo byte UTF-8 thật (không cắt dữ liệu).
 * 2. Gọi `resolveWorkspaceScope` (đúng 1 request `/api/me`).
 * 3. Kiểm trần tối đa 5 phòng fork đang hoạt động.
 * 4. Gọi `forkSnapshot` để ghi dự án mới kèm `roomFork` trong 1 transaction IndexedDB.
 */
export async function forkRoomToWorkspace(
  input: RoomForkInput,
  options: RoomForkOptions = {},
): Promise<RoomForkResult> {
  const size = checkForkSize(input.tabs);
  if (!size.ok) {
    const cause: RoomForkTooLargeCause = { bytes: size.bytes, tabName: size.tabName };
    throw new ForkError(
      "FORK_TOO_LARGE",
      `Dữ liệu vượt giới hạn ${ROOM_FORK_MAX_BYTES} byte (${size.bytes} byte), tab: ${size.tabName}`,
      cause,
    );
  }

  const scope = await resolveWorkspaceScope(options.fetchImpl);
  const active = await countActiveForks(scope, { factory: options.factory });
  if (active >= ROOM_FORK_MAX_ACTIVE) {
    const cause: RoomForkLimitCause = { active, max: ROOM_FORK_MAX_ACTIVE };
    throw new ForkError(
      "FORK_LIMIT_REACHED",
      `Đã đạt giới hạn ${ROOM_FORK_MAX_ACTIVE} phòng fork (${active}/${ROOM_FORK_MAX_ACTIVE})`,
      cause,
    );
  }

  const at = (options.now ?? Date.now)();
  const result = await forkSnapshot(
    {
      v: 1,
      project: { name: input.projectName, engine: input.engine },
      tabs: input.tabs,
    },
    scope,
    {
      ...options,
      now: () => at,
      name: options.name ?? `${input.projectName} — Fork ${formatForkTimestamp(at)}`,
      roomFork: { projectId: input.projectId, forkedAt: at },
    },
  );

  return { ...result, activeForks: active + 1 };
}
