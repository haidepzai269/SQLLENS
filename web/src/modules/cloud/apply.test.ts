// Test `pullIntoProject` (Task154): bản cloud thay nội dung đang mở, dự án giữ nguyên id, và
// mọi thứ nằm trong một transaction với IndexedDB thật (fake-indexeddb).

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import { scopeKey, type WorkspaceProject, type WorkspaceTab } from "@/modules/workspace/types";
import { pullIntoProject } from "./apply";
import { projectCloudState, projectStamp } from "./status";
import { CloudSyncError } from "./sync";

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
});

const project: WorkspaceProject = {
  id: "local-1",
  scopeKey: scopeKey({ kind: "guest" }),
  name: "Bản trên máy",
  engine: "postgres",
  createdAt: 1,
  updatedAt: 2,
  cloud: { remoteId: "remote-1", remoteUpdatedAt: "2026-11-20T10:00:00Z", stamp: "cu" },
};

const localTabs: WorkspaceTab[] = [
  { id: "t-old", projectId: "local-1", name: "01.sql", sql: "SELECT 'cu'", position: 0, updatedAt: 2 },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const remote = {
  id: "remote-1",
  name: "Bản cloud",
  engine: "mysql",
  tabCount: 2,
  createdAt: "2026-11-20T09:00:00Z",
  updatedAt: "2026-11-21T10:00:00Z",
  tabs: [
    { name: "b.sql", sql: "SELECT 2", position: 1 },
    { name: "a.sql", sql: "SELECT 1", position: 0 },
  ],
};

function fakeFetch(handler: () => Response | Promise<Response>) {
  return (async () => handler()) as typeof fetch;
}

function sequentialIds() {
  let n = 0;
  return () => `new-${++n}`;
}

async function seedLocal() {
  const db = await openWorkspaceDb(factory);
  try {
    await getRepository(db).putProjectWithTabs(project, localTabs);
  } finally {
    db.close();
  }
}

async function readLocal() {
  const db = await openWorkspaceDb(factory);
  try {
    const repo = getRepository(db);
    return { project: await repo.getProject(project.id), tabs: await repo.listTabs(project.id) };
  } finally {
    db.close();
  }
}

describe("pullIntoProject", () => {
  it("thay toàn bộ tab trong một dự án, giữ nguyên id dự án, xóa tab cũ", async () => {
    await seedLocal();

    const result = await pullIntoProject(project.id, {
      factory,
      fetchImpl: fakeFetch(() => jsonResponse(200, { project: remote })),
      now: () => 100,
      newId: sequentialIds(),
    });

    expect(result.project.id).toBe(project.id);
    expect(result.project.name).toBe("Bản cloud");
    expect(result.project.engine).toBe("mysql");
    expect(result.tabs.map((t) => [t.name, t.sql, t.position])).toEqual([
      ["a.sql", "SELECT 1", 0],
      ["b.sql", "SELECT 2", 1],
    ]);

    const stored = await readLocal();
    expect(stored.project?.id).toBe(project.id);
    expect(stored.project?.name).toBe("Bản cloud");
    expect(stored.project?.cloud?.remoteUpdatedAt).toBe(remote.updatedAt);
    expect(stored.tabs.map((t) => t.id).sort()).toEqual(["new-1", "new-2"]);
    expect(stored.tabs.some((t) => t.id === "t-old")).toBe(false);
  });

  it("dấu vân tay ghi lại khớp nội dung vừa kéo, nên trạng thái là `synced`", async () => {
    await seedLocal();
    const result = await pullIntoProject(project.id, {
      factory,
      fetchImpl: fakeFetch(() => jsonResponse(200, { project: remote })),
      now: () => 100,
      newId: sequentialIds(),
    });

    expect(result.project.cloud?.stamp).toBe(projectStamp(result.project, result.tabs));
    expect(projectCloudState(result.project, result.tabs)).toBe("synced");
  });

  it("lỗi mạng thì bản trên máy nguyên vẹn", async () => {
    await seedLocal();

    await expect(
      pullIntoProject(project.id, {
        factory,
        fetchImpl: fakeFetch(() => {
          throw new TypeError("Failed to fetch");
        }),
      }),
    ).rejects.toBeInstanceOf(CloudSyncError);

    const stored = await readLocal();
    expect(stored.project?.name).toBe("Bản trên máy");
    expect(stored.tabs.map((t) => t.id)).toEqual(["t-old"]);
  });

  it("bản cloud không có tab nào thì không thay, báo lỗi rõ", async () => {
    await seedLocal();

    await expect(
      pullIntoProject(project.id, {
        factory,
        fetchImpl: fakeFetch(() => jsonResponse(200, { project: { ...remote, tabs: [] } })),
      }),
    ).rejects.toMatchObject({ code: "REJECTED", serverCode: "empty_project" });

    const stored = await readLocal();
    expect(stored.tabs.map((t) => t.id)).toEqual(["t-old"]);
  });

  it("dự án chưa từng lưu lên cloud thì không gọi mạng", async () => {
    const db = await openWorkspaceDb(factory);
    try {
      await getRepository(db).putProjectWithTabs({ ...project, cloud: undefined }, localTabs);
    } finally {
      db.close();
    }

    let called = false;
    await expect(
      pullIntoProject(project.id, {
        factory,
        fetchImpl: fakeFetch(() => {
          called = true;
          return jsonResponse(200, { project: remote });
        }),
      }),
    ).rejects.toBeInstanceOf(CloudSyncError);
    expect(called).toBe(false);
  });
});
