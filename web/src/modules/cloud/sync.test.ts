import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import { scopeKey, type WorkspaceProject, type WorkspaceScope, type WorkspaceTab } from "@/modules/workspace/types";
import { CloudSyncError, pullProject, pushProject } from "./sync";

// Test Task153: kéo/đẩy dự án với API giả, IndexedDB thật (fake-indexeddb), không mock repository.

const GUEST: WorkspaceScope = { kind: "guest" };
const NOW = 1_700_000_000_000;

const remote = {
  id: "remote-1",
  name: "Dự án Cloud",
  engine: "mysql" as const,
  tabCount: 2,
  createdAt: "2026-11-20T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
  tabs: [
    { name: "02.sql", sql: "SELECT 2", position: 1 },
    { name: "01.sql", sql: "SELECT 1", position: 0 },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; method: string; body?: Record<string, unknown> };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url: String(input), method: init?.method ?? "GET", body });
    return handler(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

function sequentialIds(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedLocal(project: WorkspaceProject, tabs: WorkspaceTab[] = []) {
  const db = await openWorkspaceDb(factory);
  try {
    await getRepository(db).putProjectWithTabs(project, tabs);
  } finally {
    db.close();
  }
}

async function readLocal(id: string) {
  const db = await openWorkspaceDb(factory);
  try {
    const repo = getRepository(db);
    return { project: await repo.getProject(id), tabs: await repo.listTabs(id) };
  } finally {
    db.close();
  }
}

function localProject(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    id: "local-1",
    scopeKey: scopeKey(GUEST),
    name: "Dự án trên máy",
    engine: "postgres",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("pullProject", () => {
  it("AC1: tạo project + tab local đúng thứ tự, giữ engine và ghi liên kết cloud", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { project: remote }));
    const project = await pullProject("remote-1", GUEST, {
      factory,
      fetchImpl: impl,
      now: () => NOW,
      newId: sequentialIds("local"),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/v1/cloud/projects/remote-1", method: "GET" });
    expect(project.name).toBe("Dự án Cloud");
    expect(project.engine).toBe("mysql");
    expect(project.scopeKey).toBe("guest");
    expect(project.cloud).toEqual({ remoteId: "remote-1", remoteUpdatedAt: remote.updatedAt });

    const { project: stored, tabs } = await readLocal(project.id);
    expect(stored?.cloud?.remoteId).toBe("remote-1");
    expect(tabs.map((t) => t.name)).toEqual(["01.sql", "02.sql"]);
    expect(tabs.map((t) => t.sql)).toEqual(["SELECT 1", "SELECT 2"]);
    expect(tabs.map((t) => t.position)).toEqual([0, 1]);
  });

  it("dự án cloud đã bị xóa: NOT_FOUND và không ghi gì vào máy", async () => {
    const { impl } = fakeFetch(() => jsonResponse(404, { error: { code: "not_found", messageKey: "error.notFound" } }));
    await expect(pullProject("remote-x", GUEST, { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const db = await openWorkspaceDb(factory);
    const projects = await getRepository(db).listProjects(GUEST);
    db.close();
    expect(projects).toHaveLength(0);
  });

  it("mất mạng: NETWORK", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(pullProject("remote-1", GUEST, { factory, fetchImpl: impl })).rejects.toBeInstanceOf(CloudSyncError);
    await expect(pullProject("remote-1", GUEST, { factory, fetchImpl: impl })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("token hết hạn: AUTH_REQUIRED", async () => {
    const { impl } = fakeFetch(() => jsonResponse(401, { error: { code: "auth_required", messageKey: "error.authRequired" } }));
    await expect(pullProject("remote-1", GUEST, { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("pushProject", () => {
  it("AC2: đẩy lần đầu tạo mới, rồi ghi liên kết và updatedAt theo server", async () => {
    await seedLocal(localProject(), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabCount: 1, tabs: undefined };
    const { impl, calls } = fakeFetch(() => jsonResponse(201, { project: pushed }));

    const result = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(result).toEqual({ kind: "ok", updatedAt: "2026-11-21T08:30:00Z" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/v1/cloud/projects");
    expect(calls[0].body).toMatchObject({
      name: "Dự án trên máy",
      engine: "postgres",
      tabs: [{ name: "q1", sql: "SELECT 1" }],
    });
    // Chưa từng đồng bộ: không gửi baseUpdatedAt.
    expect(calls[0].body && "baseUpdatedAt" in calls[0].body).toBe(false);

    const { project } = await readLocal("local-1");
    expect(project?.cloud).toEqual({ remoteId: "remote-9", remoteUpdatedAt: "2026-11-21T08:30:00Z" });
    expect(project?.updatedAt).toBe(Date.parse("2026-11-21T08:30:00Z"));
  });

  it("đã đồng bộ trước: PUT lên remoteId kèm baseUpdatedAt của lần trước", async () => {
    await seedLocal(localProject({ cloud: { remoteId: "remote-9", remoteUpdatedAt: "2026-11-20T10:00:00Z" } }));
    const { impl, calls } = fakeFetch(() =>
      jsonResponse(200, { project: { ...remote, id: "remote-9", updatedAt: "2026-11-21T09:00:00Z" } }),
    );

    await pushProject("local-1", { factory, fetchImpl: impl });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("/api/v1/cloud/projects/remote-9");
    expect(calls[0].body?.baseUpdatedAt).toBe("2026-11-20T10:00:00Z");
  });

  it("AC3: server đã bị máy khác sửa → trả conflict và KHÔNG ghi đè bản local", async () => {
    const cloud = { remoteId: "remote-9", remoteUpdatedAt: "2026-11-20T10:00:00Z" };
    await seedLocal(localProject({ cloud }), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const { impl } = fakeFetch(() =>
      jsonResponse(409, {
        error: { code: "conflict", messageKey: "error.badRequest" },
        conflict: { remoteUpdatedAt: "2026-11-21T09:00:00Z" },
      }),
    );

    const result = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(result).toEqual({
      kind: "conflict",
      remoteUpdatedAt: "2026-11-21T09:00:00Z",
      localUpdatedAt: NOW,
    });
    const { project, tabs } = await readLocal("local-1");
    expect(project?.cloud).toEqual(cloud);
    expect(project?.updatedAt).toBe(NOW);
    expect(tabs[0].sql).toBe("SELECT 1");
  });

  it("AC4: mất mạng giữa lúc đẩy → NETWORK, local nguyên vẹn, lần sau đẩy lại được", async () => {
    await seedLocal(localProject());
    const ok = { ...remote, id: "remote-9", updatedAt: "2026-11-21T09:00:00Z" };
    let attempt = 0;
    const { impl, calls } = fakeFetch(() => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("network down");
      return jsonResponse(201, { project: ok });
    });

    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({ code: "NETWORK" });
    const afterFailure = await readLocal("local-1");
    expect(afterFailure.project?.cloud).toBeUndefined();
    expect(afterFailure.project?.updatedAt).toBe(NOW);

    const result = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(result.kind).toBe("ok");
    expect(calls).toHaveLength(2);
    // Lần thử lại vẫn là tạo mới vì chưa có liên kết cloud.
    expect(calls[1].method).toBe("POST");
    const afterRetry = await readLocal("local-1");
    expect(afterRetry.project?.cloud?.remoteId).toBe("remote-9");
  });

  it("server từ chối vì quota/tab quá lớn: REJECTED kèm mã cụ thể để UI dịch thông báo", async () => {
    await seedLocal(localProject());
    const { impl } = fakeFetch(() =>
      jsonResponse(400, { error: { code: "too_many_tabs", messageKey: "error.badRequest" } }),
    );
    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "REJECTED",
      serverCode: "too_many_tabs",
    });
  });

  it("dự án local không tồn tại: LOCAL_NOT_FOUND, không gọi mạng", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { project: remote }));
    await expect(pushProject("khong-co", { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "LOCAL_NOT_FOUND",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("AC5: không có đồng bộ tự động", () => {
  it("module không chứa timer hay setInterval", () => {
    for (const file of ["./sync.ts", "./api.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      // Chỉ bắt lời gọi thật (có dấu mở ngoặc), để câu chú thích "không setInterval" không làm test đỏ.
      expect(source).not.toMatch(/\b(setInterval|setTimeout|requestIdleCallback|queueMicrotask)\s*\(/);
    }
  });

  it("import lại module không tự gọi mạng: chỉ gọi khi người dùng bấm", async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    try {
      await import("./sync");
      await import("./api");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
