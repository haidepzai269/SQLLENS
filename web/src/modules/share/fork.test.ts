import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumePendingProject, markPendingProject } from "@/modules/workspace/pending-project";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import { scopeKey, type WorkspaceScope } from "@/modules/workspace/types";
import {
  FORK_HISTORY_KEY,
  ForkError,
  forkSnapshot,
  hasForkedSnapshot,
  resolveWorkspaceScope,
  snapshotFingerprint,
} from "./fork";
import type { SnapshotV1 } from "./snapshot";

// Storage tối giản: kiểm được cả nhánh "trình duyệt chặn storage" mà không cần jsdom thật.
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
const USER: WorkspaceScope = { kind: "user", userId: "u-1" };

function snapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    v: 1,
    project: { name: "E-Commerce Deadlock Test", engine: "postgres" },
    tabs: [
      { name: "01_schema.sql", sql: "CREATE TABLE accounts (id serial primary key);" },
      { name: "02_deadlock_sim.sql", sql: "BEGIN;\nUPDATE accounts SET balance = 0 WHERE id = 1;\nCOMMIT;" },
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

async function readScope(scope: WorkspaceScope) {
  const db = await openWorkspaceDb(factory);
  try {
    const repo = getRepository(db);
    const projects = await repo.listProjects(scope);
    const tabs = (await Promise.all(projects.map((p) => repo.listTabs(p.id)))).flat();
    return { projects, tabs };
  } finally {
    db.close();
  }
}

describe("forkSnapshot (Task147)", () => {
  it("AC1: tạo đúng dự án + đúng số tab, giữ tên/thứ tự/nội dung và engine", async () => {
    const snap = snapshot();
    const result = await forkSnapshot(snap, GUEST, {
      factory,
      storage,
      session,
      newId: sequentialIds("id"),
      now: () => 1_000,
      suffix: " (bản sao)",
    });

    expect(result.tabs).toBe(2);
    const { projects, tabs } = await readScope(GUEST);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: result.projectId,
      scopeKey: "guest",
      name: "E-Commerce Deadlock Test (bản sao)",
      engine: "postgres",
    });

    const projectTabs = tabs.filter((t) => t.projectId === result.projectId).sort((a, b) => a.position - b.position);
    expect(projectTabs.map((t) => t.name)).toEqual(["01_schema.sql", "02_deadlock_sim.sql"]);
    expect(projectTabs.map((t) => t.sql)).toEqual(snap.tabs.map((t) => t.sql));
    expect(projectTabs.map((t) => t.position)).toEqual([0, 1]);
    // Id tab phải mới, không dùng lại tên hay id nào của snapshot.
    expect(new Set(projectTabs.map((t) => t.id)).size).toBe(2);
  });

  it("AC5: không đụng dự án khác trong cùng scope", async () => {
    const db = await openWorkspaceDb(factory);
    const repo = getRepository(db);
    await repo.upsertProject({
      id: "existing",
      scopeKey: "guest",
      name: "Dự án cũ",
      engine: "sqlite",
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.upsertTab({
      id: "existing-tab",
      projectId: "existing",
      name: "Query 1",
      sql: "SELECT 1;",
      position: 0,
      updatedAt: 1,
    });
    db.close();

    const result = await forkSnapshot(snapshot(), GUEST, { factory, storage, session, newId: sequentialIds("new") });

    const { projects, tabs } = await readScope(GUEST);
    expect(projects.map((p) => p.id).sort()).toEqual(["existing", result.projectId].sort());
    const old = projects.find((p) => p.id === "existing");
    expect(old).toMatchObject({ name: "Dự án cũ", engine: "sqlite" });
    const oldTab = tabs.find((t) => t.id === "existing-tab");
    expect(oldTab).toMatchObject({ name: "Query 1", sql: "SELECT 1;", position: 0 });
  });

  it("AC: scope user ghi đúng scopeKey, không lẫn sang guest", async () => {
    await forkSnapshot(snapshot(), USER, { factory, storage, session, newId: sequentialIds("u") });

    const userData = await readScope(USER);
    const guestData = await readScope(GUEST);
    expect(userData.projects).toHaveLength(1);
    expect(userData.projects[0].scopeKey).toBe(scopeKey(USER));
    expect(guestData.projects).toHaveLength(0);
  });

  it("ca biên: snapshot 0 tab vẫn tạo dự án (lab tự thêm tab mặc định khi mở)", async () => {
    const result = await forkSnapshot(snapshot({ tabs: [] }), GUEST, {
      factory,
      storage,
      session,
      newId: sequentialIds("empty"),
    });

    expect(result.tabs).toBe(0);
    const { projects, tabs } = await readScope(GUEST);
    expect(projects).toHaveLength(1);
    expect(tabs).toHaveLength(0);
  });

  it("IndexedDB bị chặn thì báo FORK_STORAGE_UNAVAILABLE, không ném lỗi lạ", async () => {
    const broken = { open: () => { throw new Error("blocked"); } } as unknown as IDBFactory;

    await expect(forkSnapshot(snapshot(), GUEST, { factory: broken, storage, session })).rejects.toMatchObject({
      name: "ForkError",
      code: "FORK_STORAGE_UNAVAILABLE",
    });
  });

  it("AC2: ghi id dự án mới để workspace tự mở sau khi điều hướng", async () => {
    const result = await forkSnapshot(snapshot(), GUEST, { factory, storage, session, newId: sequentialIds("p") });

    expect(consumePendingProject(session)).toBe(result.projectId);
    // Chỉ mở một lần: lần boot sau không mở lại dự án cũ.
    expect(consumePendingProject(session)).toBeNull();
  });
});

describe("lịch sử fork (AC3)", () => {
  it("dấu vân tay tất định theo nội dung snapshot", () => {
    expect(snapshotFingerprint(snapshot())).toBe(snapshotFingerprint(snapshot()));
    expect(snapshotFingerprint(snapshot())).not.toBe(snapshotFingerprint(snapshot({ project: { name: "Khác", engine: "postgres" } })));
  });

  it("fork lần đầu chưa có cảnh báo, lần sau có; danh sách lưu trong localStorage", async () => {
    const fp = snapshotFingerprint(snapshot());
    expect(hasForkedSnapshot(fp, storage)).toBe(false);

    await forkSnapshot(snapshot(), GUEST, { factory, storage, session, newId: sequentialIds("h") });

    expect(hasForkedSnapshot(fp, storage)).toBe(true);
    expect(storage.getItem(FORK_HISTORY_KEY)).toContain(fp);
  });

  it("localStorage bị chặn thì không ném lỗi, chỉ mất lời nhắc", () => {
    expect(() => hasForkedSnapshot("abc", null)).not.toThrow();
    expect(hasForkedSnapshot("abc", null)).toBe(false);
  });
});

describe("resolveWorkspaceScope", () => {
  it("200 + id thì dùng scope user", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "u-9" }), { status: 200 })) as unknown as typeof fetch;
    await expect(resolveWorkspaceScope(fetchImpl)).resolves.toEqual({ kind: "user", userId: "u-9" });
  });

  it("401 hoặc lỗi mạng thì rơi về guest", async () => {
    const unauthorized = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(resolveWorkspaceScope(unauthorized)).resolves.toEqual({ kind: "guest" });

    const failing = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(resolveWorkspaceScope(failing)).resolves.toEqual({ kind: "guest" });
  });
});

describe("markPendingProject", () => {
  it("storage bị chặn thì bỏ qua an toàn", () => {
    expect(() => markPendingProject("p1", null)).not.toThrow();
    expect(consumePendingProject(null)).toBeNull();
  });
});

describe("ForkError", () => {
  it("giữ mã lỗi để giao diện chọn đúng câu báo", () => {
    const err = new ForkError("FORK_QUOTA_EXCEEDED", "đầy");
    expect(err.code).toBe("FORK_QUOTA_EXCEEDED");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ForkError");
  });
});

// Giữ tham chiếu để tránh bị coi là import thừa khi chạy ở chế độ strict.
void markPendingProject;
