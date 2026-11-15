import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_DB_VERSION, INDEX_BY_PROJECT, INDEX_BY_SCOPE, openWorkspaceDb, STORE_META, STORE_PROJECTS, STORE_TABS } from "./db";
import { getRepository, toWorkspaceError, WorkspaceQuotaError } from "./repository";
import { scopeKey, type WorkspaceProject, type WorkspaceTab } from "./types";

const GUEST = { kind: "guest" } as const;
const ALICE = { kind: "user", userId: "a1b2" } as const;
const BOB = { kind: "user", userId: "c3d4" } as const;

const project = (over: Partial<WorkspaceProject> & { id: string }): WorkspaceProject => ({
  scopeKey: "guest",
  name: "Dự án",
  engine: "postgres",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const tab = (over: Partial<WorkspaceTab> & { id: string; projectId: string }): WorkspaceTab => ({
  name: "Query 1",
  sql: "select 1",
  position: 0,
  updatedAt: 1,
  ...over,
});

let factory: IDBFactory;
let db: IDBDatabase;

beforeEach(async () => {
  factory = new IDBFactory(); // mỗi test một IndexedDB thật, riêng biệt
  db = await openWorkspaceDb(factory);
  return () => db.close();
});

describe("openWorkspaceDb", () => {
  it("tạo đúng 3 store và 2 index", () => {
    expect(Array.from(db.objectStoreNames).sort()).toEqual([STORE_META, STORE_PROJECTS, STORE_TABS].sort());
    const tx = db.transaction([STORE_PROJECTS, STORE_TABS], "readonly");
    expect(Array.from(tx.objectStore(STORE_PROJECTS).indexNames)).toEqual([INDEX_BY_SCOPE]);
    expect(Array.from(tx.objectStore(STORE_TABS).indexNames)).toEqual([INDEX_BY_PROJECT]);
  });

  it("mở lần hai cùng version không lỗi và dữ liệu cũ còn nguyên", async () => {
    await getRepository(db).upsertProject(project({ id: "p1", name: "Tab cũ" }));
    db.close();
    const again = await openWorkspaceDb(factory);
    expect(again.version).toBe(CURRENT_DB_VERSION);
    expect((await getRepository(again).getProject("p1"))?.name).toBe("Tab cũ");
    again.close();
  });
});

describe("scope", () => {
  it("đặt khoá theo scope", () => {
    expect(scopeKey(GUEST)).toBe("guest");
    expect(scopeKey(ALICE)).toBe("user_a1b2");
  });

  it("hai project cùng tên ở hai scope cùng tồn tại và listProjects lọc đúng", async () => {
    const repo = getRepository(db);
    await repo.upsertProject(project({ id: "g1", name: "Shop", scopeKey: scopeKey(GUEST) }));
    await repo.upsertProject(project({ id: "a1", name: "Shop", scopeKey: scopeKey(ALICE), createdAt: 2 }));
    await repo.upsertProject(project({ id: "b1", name: "Shop", scopeKey: scopeKey(BOB), createdAt: 3 }));

    expect((await repo.listProjects(GUEST)).map((p) => p.id)).toEqual(["g1"]);
    expect((await repo.listProjects(ALICE)).map((p) => p.id)).toEqual(["a1"]);
    expect(await repo.listProjects({ kind: "user", userId: "khong-co" })).toEqual([]);
    expect((await repo.listProjects(GUEST))[0].name).toBe("Shop");
  });
});

describe("project và tab", () => {
  it("id trùng thì ghi đè bản cũ chứ không nhân đôi", async () => {
    const repo = getRepository(db);
    await repo.upsertProject(project({ id: "p1", name: "Tên cũ" }));
    await repo.upsertProject(project({ id: "p1", name: "Tên mới", updatedAt: 5 }));
    const rows = await repo.listProjects(GUEST);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Tên mới");
  });

  it("deleteProjectCascade xóa project và tab của nó, không đụng project khác", async () => {
    const repo = getRepository(db);
    await repo.upsertProject(project({ id: "p1" }));
    await repo.upsertProject(project({ id: "p2", createdAt: 2 }));
    await repo.upsertTab(tab({ id: "t1", projectId: "p1", position: 0 }));
    await repo.upsertTab(tab({ id: "t2", projectId: "p1", position: 1 }));
    await repo.upsertTab(tab({ id: "t3", projectId: "p2" }));

    await repo.deleteProjectCascade("p1");

    expect(await repo.getProject("p1")).toBeUndefined();
    expect(await repo.listTabs("p1")).toEqual([]);
    expect(await repo.countTabs("p1")).toBe(0);
    expect(await repo.getProject("p2")).toBeDefined();
    expect((await repo.listTabs("p2")).map((t) => t.id)).toEqual(["t3"]);
  });

  it("xóa project không tồn tại không ném lỗi", async () => {
    await expect(getRepository(db).deleteProjectCascade("khong-co")).resolves.toBeUndefined();
  });

  it("tab trả về đúng thứ tự position", async () => {
    const repo = getRepository(db);
    await repo.upsertProject(project({ id: "p1" }));
    await repo.upsertTab(tab({ id: "b", projectId: "p1", position: 2 }));
    await repo.upsertTab(tab({ id: "a", projectId: "p1", position: 0 }));
    await repo.upsertTab(tab({ id: "c", projectId: "p1", position: 1 }));
    expect((await repo.listTabs("p1")).map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(await repo.countTabs("p1")).toBe(3);
  });

  it("tab mồ côi (project đã xóa) bị dọn khi cascade lần nữa, listTabs tab mồ côi vẫn đọc được", async () => {
    const repo = getRepository(db);
    await repo.upsertProject(project({ id: "p1" }));
    await repo.upsertTab(tab({ id: "t1", projectId: "p1" }));
    await repo.deleteProjectCascade("p1");
    await repo.upsertTab(tab({ id: "t9", projectId: "p-da-xoa" }));
    expect((await repo.listTabs("p-da-xoa")).map((t) => t.id)).toEqual(["t9"]);
    await repo.deleteProjectCascade("p-da-xoa");
    expect(await repo.listTabs("p-da-xoa")).toEqual([]);
  });
});

describe("hết quota", () => {
  it("dịch QuotaExceededError thành WorkspaceQuotaError", () => {
    const err = toWorkspaceError(new DOMException("đầy", "QuotaExceededError"));
    expect(err).toBeInstanceOf(WorkspaceQuotaError);
    expect((err as WorkspaceQuotaError).code).toBe("WORKSPACE_QUOTA_EXCEEDED");
  });

  // fake-indexeddb không ném được lỗi quota như trình duyệt thật, nên phần này
  // dựng một transaction lỗi đúng hình dạng IDB để kiểm nhánh dịch lỗi của repository.
  it("repository ném WorkspaceQuotaError khi transaction báo hết quota", async () => {
    const failing = { error: new DOMException("đầy", "QuotaExceededError") } as unknown as IDBRequest;
    const fakeTx = {
      objectStore: () => ({ put: () => failing }),
      error: new DOMException("đầy", "QuotaExceededError"),
      abort: () => undefined,
    } as unknown as IDBTransaction;
    Object.defineProperty(failing, "onerror", {
      set(fn: (() => void) | null) {
        queueMicrotask(() => fn?.());
      },
    });
    Object.defineProperty(fakeTx, "onabort", {
      set(fn: (() => void) | null) {
        queueMicrotask(() => fn?.());
      },
    });
    const fakeDb = { transaction: () => fakeTx } as unknown as IDBDatabase;

    await expect(getRepository(fakeDb).upsertProject(project({ id: "p1" }))).rejects.toBeInstanceOf(WorkspaceQuotaError);
  });
});

describe("ranh giới module", () => {
  it("không có fetch hay XMLHttpRequest: nháp không rời máy", () => {
    const files = ["types.ts", "db.ts", "repository.ts"].map((f) =>
      readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8"),
    );
    for (const source of files) {
      expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
    }
  });
});
