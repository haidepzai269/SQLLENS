import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import { ForkError } from "@/modules/share/fork";
import type { WorkspaceScope } from "@/modules/workspace/types";
import {
  ROOM_FORK_MAX_ACTIVE,
  ROOM_FORK_MAX_BYTES,
  checkForkSize,
  countActiveForks,
  forkRoomToWorkspace,
  type RoomForkInput,
} from "./room-fork";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const GUEST: WorkspaceScope = { kind: "guest" };
const USER: WorkspaceScope = { kind: "user", userId: "u-167" };

function makeInput(overrides: Partial<RoomForkInput> = {}): RoomForkInput {
  return {
    projectId: "room-proj-1",
    projectName: "Phòng thực hành Deadlock",
    engine: "postgres",
    tabs: [
      { name: "01_schema.sql", sql: "CREATE TABLE t(id INT PRIMARY KEY);" },
      { name: "02_seed.sql", sql: "INSERT INTO t VALUES (1), (2);" },
      { name: "03_query.sql", sql: "SELECT * FROM t ORDER BY id;" },
    ],
    ...overrides,
  };
}

function sequentialIds(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

let factory: IDBFactory;
let storage: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  factory = new IDBFactory();
  storage = new MemoryStorage();
  session = new MemoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkForkSize", () => {
  it("cho phép mảng tab nằm trong ngưỡng 512 KB", () => {
    const res = checkForkSize(makeInput().tabs);
    expect(res.ok).toBe(true);
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.bytes).toBeLessThanOrEqual(ROOM_FORK_MAX_BYTES);
  });

  it("đo theo byte UTF-8 thật với ký tự tiếng Việt / Unicode (không dùng .length)", () => {
    // 'ệ' chiếm 3 byte UTF-8; 200_000 ký tự có .length < 512*1024 nhưng UTF-8 > 512*1024.
    const unicodeSql = "ệ".repeat(200_000);
    expect(unicodeSql.length).toBeLessThan(ROOM_FORK_MAX_BYTES);

    const res = checkForkSize([
      { name: "small.sql", sql: "SELECT 1;" },
      { name: "unicode_heavy.sql", sql: unicodeSql },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.bytes).toBeGreaterThan(ROOM_FORK_MAX_BYTES);
      expect(res.tabName).toBe("unicode_heavy.sql");
    }
  });
});

describe("countActiveForks & forkRoomToWorkspace", () => {
  it("AC1: fork 3 tab tạo dự án mới có roomFork, giữ nguyên nội dung, không đụng dự án gốc", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "u-167" }), { status: 200 }));

    // Tạo dự án gốc của phòng trong cùng scope để kiểm tra không bị sửa đổi.
    const db0 = await openWorkspaceDb(factory);
    await getRepository(db0).putProjectWithTabs(
      {
        id: "room-proj-1",
        scopeKey: "user_u-167",
        name: "Phòng thực hành Deadlock",
        engine: "postgres",
        createdAt: 100,
        updatedAt: 100,
      },
      [{ id: "orig-t1", projectId: "room-proj-1", name: "orig.sql", sql: "SELECT 42;", position: 0, updatedAt: 100 }],
    );
    db0.close();

    const result = await forkRoomToWorkspace(makeInput(), {
      factory,
      storage,
      session,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      newId: sequentialIds("fork"),
      now: () => Date.UTC(2026, 10, 25, 6, 45),
    });

    expect(result.tabs).toBe(3);
    expect(result.activeForks).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/me", { credentials: "same-origin", cache: "no-store" });

    const db = await openWorkspaceDb(factory);
    const repo = getRepository(db);
    const projects = await repo.listProjects(USER);
    expect(projects).toHaveLength(2);

    const forked = projects.find((p) => p.id === result.projectId);
    expect(forked).toBeDefined();
    expect(forked?.name).toBe("Phòng thực hành Deadlock — Fork 2026-11-25 06:45");
    expect(forked?.roomFork).toEqual({ projectId: "room-proj-1", forkedAt: Date.UTC(2026, 10, 25, 6, 45) });

    const forkedTabs = await repo.listTabs(result.projectId);
    expect(forkedTabs.map((t) => ({ name: t.name, sql: t.sql, position: t.position }))).toEqual([
      { name: "01_schema.sql", sql: "CREATE TABLE t(id INT PRIMARY KEY);", position: 0 },
      { name: "02_seed.sql", sql: "INSERT INTO t VALUES (1), (2);", position: 1 },
      { name: "03_query.sql", sql: "SELECT * FROM t ORDER BY id;", position: 2 },
    ]);

    // Dự án gốc giữ nguyên.
    const origTabs = await repo.listTabs("room-proj-1");
    expect(origTabs).toHaveLength(1);
    expect(origTabs[0].sql).toBe("SELECT 42;");
    db.close();
  });

  it("AC2/AC3: chặn ở fork thứ 6 bằng FORK_LIMIT_REACHED; xóa 1 bản thì fork lại được", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 401 }));
    let ts = 1_000;
    const ids = sequentialIds("f");

    for (let i = 0; i < ROOM_FORK_MAX_ACTIVE; i++) {
      await forkRoomToWorkspace(makeInput(), {
        factory,
        storage,
        session,
        fetchImpl: fetchSpy as unknown as typeof fetch,
        newId: ids,
        now: () => ++ts,
      });
    }

    expect(await countActiveForks(GUEST, { factory })).toBe(5);

    await expect(
      forkRoomToWorkspace(makeInput(), {
        factory,
        storage,
        session,
        fetchImpl: fetchSpy as unknown as typeof fetch,
        newId: ids,
        now: () => ++ts,
      }),
    ).rejects.toMatchObject({ code: "FORK_LIMIT_REACHED" });

    // Xóa bớt 1 dự án fork -> còn 4 và cho phép fork lại.
    const db = await openWorkspaceDb(factory);
    const projects = await getRepository(db).listProjects(GUEST);
    await getRepository(db).deleteProjectCascade(projects[0].id);
    db.close();

    expect(await countActiveForks(GUEST, { factory })).toBe(4);
    const afterDelete = await forkRoomToWorkspace(makeInput(), {
      factory,
      storage,
      session,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      newId: ids,
      now: () => ++ts,
    });
    expect(afterDelete.activeForks).toBe(5);
  });

  it("AC4: vượt 512 KB bị từ chối ngay với FORK_TOO_LARGE và không gọi /api/me", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 401 }));
    const bigSql = "A".repeat(ROOM_FORK_MAX_BYTES + 10);

    let caught: unknown;
    try {
      await forkRoomToWorkspace(
        makeInput({ tabs: [{ name: "huge_dump.sql", sql: bigSql }] }),
        { factory, storage, session, fetchImpl: fetchSpy as unknown as typeof fetch },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForkError);
    const err = caught as ForkError;
    expect(err.code).toBe("FORK_TOO_LARGE");
    expect(err.cause).toMatchObject({ tabName: "huge_dump.sql" });
    expect((err.cause as { bytes: number }).bytes).toBeGreaterThan(ROOM_FORK_MAX_BYTES);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chặn IndexedDB ở chế độ ẩn danh ném FORK_STORAGE_UNAVAILABLE", async () => {
    const blockedFactory = {
      open() {
        throw new DOMException("SecurityError");
      },
    } as unknown as IDBFactory;

    await expect(countActiveForks(GUEST, { factory: blockedFactory })).rejects.toMatchObject({
      code: "FORK_STORAGE_UNAVAILABLE",
    });
  });
});
