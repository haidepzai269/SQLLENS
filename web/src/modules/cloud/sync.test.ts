import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository, WorkspaceQuotaError } from "@/modules/workspace/repository";
import { scopeKey, type WorkspaceProject, type WorkspaceScope, type WorkspaceTab } from "@/modules/workspace/types";
import { CloudSyncError, detachCloudLink, forgetUnpersistedLinks, pullProject, pushProject } from "./sync";

// Test Task153: kéo/đẩy dự án với API giả, IndexedDB thật (fake-indexeddb), không mock repository.

// Cờ để giả lập "ghi IndexedDB hỏng sau khi server đã nhận" (hết dung lượng). Chỉ bật ở đúng ca
// kiểm LỖI 4; mọi ca khác dùng repository thật nguyên vẹn.
//
// Chặn cả `patchProjectCloud` (đường `pushProject` dùng để ghi liên kết cloud sau khi server nhận)
// lẫn `upsertProject` (đường cũ, và đường các test khác dùng để dựng dữ liệu).
const failUpsert = vi.hoisted(() => ({ times: 0 }));

vi.mock("@/modules/workspace/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/workspace/repository")>();
  const maybeFail = () => {
    if (failUpsert.times > 0) {
      failUpsert.times -= 1;
      throw new WorkspaceQuotaError(new Error("QuotaExceededError (giả lập)"));
    }
  };
  return {
    ...actual,
    getRepository: (db: IDBDatabase) => {
      const repo = actual.getRepository(db);
      return {
        ...repo,
        upsertProject: async (record: WorkspaceProject) => {
          maybeFail();
          return repo.upsertProject(record);
        },
        patchProjectCloud: async (id: string, cloud: NonNullable<WorkspaceProject["cloud"]>, updatedAt: number) => {
          maybeFail();
          return repo.patchProjectCloud(id, cloud, updatedAt);
        },
      };
    },
  };
});

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
  // Module nhớ liên kết chưa ghi được trong bộ nhớ; mỗi ca là một "lần tải trang" mới nên phải xóa,
  // nếu không ca sau sẽ thấy liên kết của ca trước (cùng id dự án "local-1").
  forgetUnpersistedLinks();
  failUpsert.times = 0;
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
    expect(project.cloud).toMatchObject({ remoteId: "remote-1", remoteUpdatedAt: remote.updatedAt });

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
    expect(result).toMatchObject({ kind: "ok", updatedAt: "2026-11-21T08:30:00Z", remoteId: "remote-9" });
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
    expect(project?.cloud).toMatchObject({ remoteId: "remote-9", remoteUpdatedAt: "2026-11-21T08:30:00Z" });
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

  // LỖI 4 (review Task153): ghi IndexedDB hỏng SAU khi server đã tạo dự án thì lần đẩy sau phải
  // là PUT, không được POST lần hai — POST lần hai sinh dự án TRÙNG trên cloud và không bao giờ
  // nhận 409 (409 chỉ có ở PUT).
  it("LỖI 4: ghi local hỏng sau khi POST thành công thì lần sau PUT, chỉ một POST duy nhất", async () => {
    await seedLocal(localProject(), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    const { impl, calls } = fakeFetch(() => jsonResponse(201, { project: pushed }));

    // Lần 1: server nhận, nhưng bước ghi IndexedDB ném QuotaExceededError.
    failUpsert.times = 1;
    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");

    // Liên kết không ghi được xuống đĩa (đúng như lỗi thật)...
    const afterFailure = await readLocal("local-1");
    expect(afterFailure.project?.cloud).toBeUndefined();

    // ...nhưng lần đẩy sau vẫn biết id của bản vừa tạo nên đi PUT, không tạo dự án thứ hai.
    const retry = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(retry).toMatchObject({ kind: "ok", remoteId: "remote-9" });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
    expect(calls[1].url).toBe("/api/v1/cloud/projects/remote-9");
    expect(calls[1].body?.baseUpdatedAt).toBe("2026-11-21T08:30:00Z");

    const afterRetry = await readLocal("local-1");
    expect(afterRetry.project?.cloud).toMatchObject({ remoteId: "remote-9" });
  });

  // LỖI 5 (review Task153): server trả 404 cho remoteId đã lưu. Trước đây là lỗi NOT_FOUND và
  // liên kết chết nằm lại IndexedDB nên mọi lần đẩy sau PUT vào id đã xóa, 404 mãi không lối ra.
  it("LỖI 5: dự án trên cloud đã bị xóa → remote_gone, giữ liên kết, có lối thoát", async () => {
    const dead = { remoteId: "remote-da-xoa", remoteUpdatedAt: "2026-11-20T10:00:00Z" };
    await seedLocal(localProject({ cloud: dead }), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const gone = () => jsonResponse(404, { error: { code: "not_found", messageKey: "error.notFound" } });
    const { impl, calls } = fakeFetch(gone);

    // Trạng thái riêng, KHÔNG phải lỗi mạng — UI phân biệt được để hỏi người dùng.
    const first = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(first).toEqual({ kind: "remote_gone", remoteId: "remote-da-xoa" });

    // Không tự xóa liên kết: quyết định thuộc về người dùng, không mất dữ liệu.
    const afterGone = await readLocal("local-1");
    expect(afterGone.project?.cloud).toEqual(dead);
    expect(afterGone.tabs).toHaveLength(1);

    // Vẫn còn lối ra: đẩy lên thành dự án mới, không cần đụng gì khác.
    const created = { ...remote, id: "remote-moi", updatedAt: "2026-11-21T11:00:00Z", tabs: undefined };
    const { impl: impl2, calls: calls2 } = fakeFetch(() => jsonResponse(201, { project: created }));
    const second = await pushProject("local-1", { factory, fetchImpl: impl2, asNew: true });
    expect(second).toMatchObject({ kind: "ok", remoteId: "remote-moi" });
    expect(calls2.map((c) => c.method)).toEqual(["POST"]);
    expect(calls2[0].body && "baseUpdatedAt" in calls2[0].body).toBe(false);

    const afterAsNew = await readLocal("local-1");
    expect(afterAsNew.project?.cloud).toMatchObject({ remoteId: "remote-moi" });
    expect(afterGone.project?.name).toBe(afterAsNew.project?.name);
    expect(calls).toHaveLength(1);
  });

  it("LỖI 5: detachCloudLink gỡ liên kết chết để lần đẩy sau là POST, giữ nguyên dữ liệu", async () => {
    const dead = { remoteId: "remote-da-xoa", remoteUpdatedAt: "2026-11-20T10:00:00Z" };
    await seedLocal(localProject({ cloud: dead }), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const { impl, calls } = fakeFetch(() =>
      jsonResponse(201, { project: { ...remote, id: "remote-moi", updatedAt: "2026-11-21T11:00:00Z" } }),
    );

    await detachCloudLink("local-1", { factory });
    const detached = await readLocal("local-1");
    expect(detached.project?.cloud).toBeUndefined();
    expect(detached.project?.name).toBe("Dự án trên máy");
    expect(detached.tabs.map((t) => t.sql)).toEqual(["SELECT 1"]);

    const result = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(result).toMatchObject({ kind: "ok", remoteId: "remote-moi" });
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });

  // Reviewer vòng 2: hai lượt đẩy SONG SONG cùng dự án đều thấy `cloud` trống nên cùng POST,
  // sinh hai dự án trùng — cùng lớp lỗi LỖI 4 nhưng ở đường thứ hai. `unpersistedLinks` chỉ
  // chặn được lượt TUẦN TỰ, nên phải có khóa theo lượt đang chạy.
  it("hai lượt đẩy song song cùng dự án: lượt thứ hai bị chặn, chỉ một POST", async () => {
    await seedLocal(localProject(), []);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    // Giữ lượt đầu lại giữa đường để lượt thứ hai chắc chắn chạy chồng lên.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      await gate;
      return jsonResponse(201, { project: pushed });
    }) as typeof fetch;

    const first = pushProject("local-1", { factory, fetchImpl: impl });
    const second = await pushProject("local-1", { factory, fetchImpl: impl }).catch((e) => e);
    release?.();

    expect(second).toMatchObject({ code: "BUSY" });
    await expect(first).resolves.toMatchObject({ kind: "ok" });
    expect(calls).toEqual(["POST"]);
  });

  it("lượt đẩy song song bị chặn không làm kẹt dự án: sau đó đẩy lại được", async () => {
    await seedLocal(localProject(), []);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = true;
    const impl = (async () => {
      if (held) {
        held = false;
        await gate;
      }
      return jsonResponse(201, { project: pushed });
    }) as typeof fetch;

    const first = pushProject("local-1", { factory, fetchImpl: impl });
    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({ code: "BUSY" });
    release?.();
    await expect(first).resolves.toMatchObject({ kind: "ok" });

    // Khóa đã nhả: lượt sau chạy bình thường và đi PUT vì đã có liên kết.
    const third = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(third).toMatchObject({ kind: "ok", remoteId: "remote-9" });
  });

  // Reviewer vòng 3 (F1): `forgetUnpersistedLinks()` cũ xóa cả `inFlight`. Mất phiên giữa lúc đang
  // đẩy thì khóa chống trùng biến mất, lượt thứ hai lọt qua và POST lần nữa → hai dự án cloud.
  it("F1: quên liên kết giữa lúc đang đẩy KHÔNG được nhả khóa chống trùng", async () => {
    await seedLocal(localProject(), []);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const methods: string[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      await gate;
      return jsonResponse(201, { project: pushed });
    }) as typeof fetch;

    const first = pushProject("local-1", { factory, fetchImpl: impl });
    // Người dùng đăng xuất đúng lúc lượt đẩy đang chờ mạng.
    forgetUnpersistedLinks();

    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({ code: "BUSY" });
    release?.();
    // Lượt đang chạy không ghi liên kết của phiên cũ: báo lỗi để giao diện biết phiên đã đổi.
    await expect(first).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(methods).toEqual(["POST"]);
  });

  // Reviewer vòng 3 (F1, vế thứ hai): lượt đẩy đang chạy không được ghi LẠI liên kết của người
  // dùng cũ sau khi phiên đã đổi — nếu không, người đăng nhập sau trong cùng tab PUT vào dự án
  // của người trước.
  it("F1: mất phiên giữa lúc đang đẩy thì liên kết của người cũ không sống lại", async () => {
    await seedLocal(localProject(), []);
    const pushed = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const methods: string[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      await gate;
      return jsonResponse(201, { project: pushed });
    }) as typeof fetch;

    const first = pushProject("local-1", { factory, fetchImpl: impl });
    forgetUnpersistedLinks();
    release?.();
    await expect(first).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    // Lượt sau (người dùng mới) phải là POST, không phải PUT vào dự án của người trước.
    await pushProject("local-1", { factory, fetchImpl: impl });
    expect(methods).toEqual(["POST", "POST"]);
  });

  // Reviewer vòng 3 (F4): nhánh mở IndexedDB hỏng phải nhả khóa, nếu không dự án kẹt BUSY vĩnh viễn.
  it("F4: mở bộ nhớ hỏng thì nhả khóa, lượt sau không bị BUSY", async () => {
    await seedLocal(localProject(), []);
    const brokenFactory = {
      open: () => {
        throw new DOMException("bị chặn", "InvalidStateError");
      },
    } as unknown as IDBFactory;
    const { impl } = fakeFetch(() => jsonResponse(201, { project: remote }));

    await expect(pushProject("local-1", { factory: brokenFactory, fetchImpl: impl })).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });

    // Khóa đã nhả: lượt sau chạy tiếp thay vì báo BUSY.
    const retry = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(retry).toMatchObject({ kind: "ok" });
  });

  // Ca mà reviewer vòng 2 tìm ra là lỗ hổng test: liên kết còn trong BỘ NHỚ (`unpersistedLinks`)
  // nhưng người dùng gỡ liên kết. Nếu nhánh detach quên xóa Map thì lần đẩy sau vẫn PUT vào
  // đúng dự án vừa gỡ, tức liên kết chết sống lại và người dùng không tạo được dự án mới.
  it("LỖI 5: detachCloudLink khi liên kết chỉ nằm trong bộ nhớ thì lần sau vẫn là POST", async () => {
    await seedLocal(localProject(), [
      { id: "t1", projectId: "local-1", name: "q1", sql: "SELECT 1", position: 0, updatedAt: NOW },
    ]);
    const first = { ...remote, id: "remote-9", updatedAt: "2026-11-21T08:30:00Z", tabs: undefined };
    const { impl, calls } = fakeFetch(() => jsonResponse(201, { project: first }));

    // Đẩy thành công ở server nhưng ghi IndexedDB hỏng → chỉ bộ nhớ biết `remote-9`.
    failUpsert.times = 1;
    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect((await readLocal("local-1")).project?.cloud).toBeUndefined();

    // Người dùng gỡ liên kết (dự án trên đĩa vốn chưa có liên kết, nên đây là nhánh sớm).
    await detachCloudLink("local-1", { factory });

    const retry = await pushProject("local-1", { factory, fetchImpl: impl });
    expect(retry).toMatchObject({ kind: "ok" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST"]);
    expect(calls[1].url).toBe("/api/v1/cloud/projects");
  });

  it("LỖI 5: 404 khác lỗi mạng — mất mạng vẫn là NETWORK, không phải remote_gone", async () => {
    await seedLocal(localProject({ cloud: { remoteId: "remote-9", remoteUpdatedAt: "2026-11-20T10:00:00Z" } }));
    const { impl } = fakeFetch(() => {
      throw new TypeError("network down");
    });
    await expect(pushProject("local-1", { factory, fetchImpl: impl })).rejects.toMatchObject({ code: "NETWORK" });
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
