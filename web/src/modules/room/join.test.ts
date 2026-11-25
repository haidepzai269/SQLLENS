import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { closeDb, CloudSyncError, openDb } from "@/modules/cloud/sync";
import { getRepository } from "@/modules/workspace/repository";
import { scopeKey, type WorkspaceScope } from "@/modules/workspace/types";
import { RoomApiError } from "./api";
import { classifyJoinError, ensureJoinedProject } from "./join";

const GUEST: WorkspaceScope = { kind: "guest" };

/** Dựng một dự án local đã gắn cloud id, giống dự án được kéo về từ lần tham gia trước. */
async function seedLinkedProject(factory: IDBFactory, remoteId: string, id = "p-1") {
  const db = await openDb(factory);
  try {
    await getRepository(db).upsertProject({
      id,
      scopeKey: scopeKey(GUEST),
      name: "Phòng thử",
      engine: "postgres",
      createdAt: 1,
      updatedAt: 1,
      cloud: { remoteId, remoteUpdatedAt: "2026-11-24T00:00:00Z" },
    });
  } finally {
    closeDb(db);
  }
}

describe("classifyJoinError", () => {
  it("tách 410 hết hạn khỏi 404 link sai — hai việc người dùng phải làm khác nhau", () => {
    expect(classifyJoinError(new RoomApiError(410, "token_expired", "x"))).toBe("expired");
    expect(classifyJoinError(new RoomApiError(404, "not_found", "x"))).toBe("invalid");
  });

  it("403 là không có quyền, 401 là cần đăng nhập", () => {
    expect(classifyJoinError(new RoomApiError(403, "forbidden", "x"))).toBe("forbidden");
    expect(classifyJoinError(new RoomApiError(401, "auth_required", "x"))).toBe("auth");
  });

  it("5xx và lỗi mạng fetch đều là network, có nút thử lại", () => {
    expect(classifyJoinError(new RoomApiError(503, "internal", "x"))).toBe("network");
    expect(classifyJoinError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("lỗi lưu máy của pullProject thành storage, không thành network", () => {
    expect(classifyJoinError(new CloudSyncError("STORAGE_UNAVAILABLE", "x"))).toBe("storage");
    expect(classifyJoinError(new CloudSyncError("QUOTA_EXCEEDED", "x"))).toBe("storage");
    expect(classifyJoinError(new CloudSyncError("NETWORK", "x"))).toBe("network");
    expect(classifyJoinError(new CloudSyncError("NOT_FOUND", "x"))).toBe("invalid");
  });

  it("lỗi lạ không được quy thành một nguyên nhân cụ thể", () => {
    expect(classifyJoinError(new Error("gì đó"))).toBe("failed");
  });
});

describe("ensureJoinedProject", () => {
  it("đã có dự án local cùng remoteId: mở lại, không kéo thêm bản sao", async () => {
    const factory = new IDBFactory();
    await seedLinkedProject(factory, "remote-1");
    const fetchImpl = vi.fn(async () => {
      throw new Error("không được gọi mạng khi dự án đã có trên máy");
    });

    const opened = await ensureJoinedProject("remote-1", GUEST, { factory, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(opened).toEqual({ projectId: "p-1", pulled: false });
    expect(fetchImpl).not.toHaveBeenCalled();

    const db = await openDb(factory);
    try {
      expect(await getRepository(db).listProjects(GUEST)).toHaveLength(1);
    } finally {
      closeDb(db);
    }
  });

  it("dự án local trùng tên nhưng khác cloud id vẫn phải kéo bản mới", async () => {
    const factory = new IDBFactory();
    await seedLinkedProject(factory, "remote-1");
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          project: {
            id: "remote-2",
            name: "Phòng thử",
            engine: "postgres",
            tabCount: 0,
            createdAt: "2026-11-24T00:00:00Z",
            updatedAt: "2026-11-24T00:00:00Z",
            tabs: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const opened = await ensureJoinedProject("remote-2", GUEST, {
      factory,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(opened.pulled).toBe(true);
    expect(opened.projectId).not.toBe("p-1");
  });

  it("IndexedDB bị chặn là lỗi lưu máy (storage), không phải lỗi chung", async () => {
    const blocked = {
      open: () => {
        throw new DOMException("chặn IndexedDB", "SecurityError");
      },
    } as unknown as IDBFactory;

    const err = await ensureJoinedProject("remote-1", GUEST, { factory: blocked }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudSyncError);
    expect(classifyJoinError(err)).toBe("storage");
  });
});
