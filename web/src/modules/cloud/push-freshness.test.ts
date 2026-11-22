// Test: đẩy lên cloud phải gửi nội dung MỚI NHẤT, không phải bản còn kẹt trong autosave.
//
// Vì sao cần: workspace ghi tab xuống IndexedDB qua autosave có debounce (mặc định 300 ms), còn
// `pushProject` đọc tab từ IndexedDB. Người dùng gõ thêm một câu rồi bấm "Lưu vào Cloud" ngay là
// chuyện bình thường, và lúc đó IndexedDB vẫn còn bản cũ. Không chặn thì cloud nhận bản cũ, panel
// báo "đã lưu", rồi autosave ghi bản mới xuống đĩa → dự án hiện `modified` ngay sau khi vừa lưu,
// và nếu người dùng đóng tab luôn thì phần vừa gõ không bao giờ lên cloud.

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootWorkspace, disposeWorkspace, flushWorkspace } from "@/modules/workspace/hydrate";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceScope } from "@/modules/workspace/types";
import { forgetUnpersistedLinks, pushProject } from "./sync";

const GUEST: WorkspaceScope = { kind: "guest" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
  useWorkspaceStore.getState().reset();
  forgetUnpersistedLinks();
});

afterEach(async () => {
  await disposeWorkspace();
  useWorkspaceStore.getState().reset();
});

describe("pushProject — đẩy đúng bản mới nhất, không phải bản còn trong autosave", () => {
  it("gõ SQL rồi lưu ngay (chưa hết debounce) thì payload mang câu vừa gõ", async () => {
    const { projectId, tabId } = await bootWorkspace(GUEST, { factory });

    // Debounce 300 ms: sau lệnh này IndexedDB vẫn còn bản rỗng.
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 42 AS cau_vua_go");

    let sent: { tabs?: Array<{ sql: string }> } | undefined;
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = init?.body ? (JSON.parse(String(init.body)) as typeof sent) : undefined;
      return jsonResponse(201, {
        project: {
          id: "remote-1",
          name: "Mặc định",
          engine: "postgres",
          tabCount: 1,
          createdAt: "2026-11-22T00:00:00Z",
          updatedAt: "2026-11-22T00:00:00Z",
        },
      });
    }) as typeof fetch;

    await pushProject(projectId, { factory, fetchImpl: impl });

    expect(sent?.tabs?.[0]?.sql).toBe("SELECT 42 AS cau_vua_go");
  });

  it("lưu xong thì trạng thái là `synced`, không phải `modified`", async () => {
    const { projectId, tabId } = await bootWorkspace(GUEST, { factory });
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 1");

    const impl = (async () =>
      jsonResponse(201, {
        project: {
          id: "remote-1",
          name: "Mặc định",
          engine: "postgres",
          tabCount: 1,
          createdAt: "2026-11-22T00:00:00Z",
          updatedAt: "2026-11-22T00:00:00Z",
        },
      })) as typeof fetch;

    const result = await pushProject(projectId, { factory, fetchImpl: impl });
    if (result.kind !== "ok") throw new Error(`mong đợi ok, nhận ${result.kind}`);

    // Panel làm đúng việc này sau khi pushProject trả về.
    useWorkspaceStore.getState().setProjectCloud(projectId, {
      remoteId: result.remoteId,
      remoteUpdatedAt: result.updatedAt,
      stamp: result.stamp,
    });

    const { projectCloudState } = await import("./status");
    const state = useWorkspaceStore.getState();
    const project = state.projects.find((p) => p.id === projectId);
    expect(project?.cloud).toBeDefined();
    // Dấu vân tay đã lưu phải khớp nội dung đang mở, nếu không panel hiện `modified` ngay sau
    // khi vừa lưu xong và người dùng tưởng cần lưu lại.
    expect(projectCloudState(project!, state.tabs)).toBe("synced");

    // Autosave ghi nốt phần còn chờ cũng không được làm lệch dấu.
    await flushWorkspace();
    const after = useWorkspaceStore.getState();
    expect(projectCloudState(after.projects[0]!, after.tabs)).toBe("synced");
  });
});
