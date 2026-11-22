// Test: đẩy lên cloud phải gửi nội dung MỚI NHẤT, không phải bản còn kẹt trong autosave.
//
// Vì sao cần: workspace ghi tab xuống IndexedDB qua autosave có debounce (mặc định 300 ms), còn
// `pushProject` đọc tab từ IndexedDB. Người dùng gõ thêm một câu rồi bấm "Lưu vào Cloud" ngay là
// chuyện bình thường, và lúc đó IndexedDB vẫn còn bản cũ. Không chặn thì cloud nhận bản cũ, panel
// báo "đã lưu", rồi autosave ghi bản mới xuống đĩa → dự án hiện `modified` ngay sau khi vừa lưu,
// và nếu người dùng đóng tab luôn thì phần vừa gõ không bao giờ lên cloud.

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { bootWorkspace, disposeWorkspace, flushWorkspace } from "@/modules/workspace/hydrate";
import { getRepository } from "@/modules/workspace/repository";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { WorkspaceScope } from "@/modules/workspace/types";
import { CloudSyncError, forgetUnpersistedLinks, pushProject } from "./sync";

const GUEST: WorkspaceScope = { kind: "guest" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createdProject(id = "remote-1") {
  return jsonResponse(201, {
    project: {
      id,
      name: "Mặc định",
      engine: "postgres",
      tabCount: 1,
      createdAt: "2026-11-22T00:00:00Z",
      updatedAt: "2026-11-22T00:00:00Z",
    },
  });
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
      return createdProject();
    }) as typeof fetch;

    await pushProject(projectId, { factory, fetchImpl: impl });

    expect(sent?.tabs?.[0]?.sql).toBe("SELECT 42 AS cau_vua_go");
  });

  it("lưu xong thì trạng thái là `synced`, không phải `modified`", async () => {
    const { projectId, tabId } = await bootWorkspace(GUEST, { factory });
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 1");

    const impl = (async () => createdProject()) as typeof fetch;

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

describe("pushProject — không ghi đè thay đổi xảy ra trong lúc chờ mạng", () => {
  // Reviewer vòng 3 đo được: `pushProject` cũ ghi `upsertProject({...project})` bằng ảnh chụp đọc
  // TRƯỚC vòng mạng. Đổi tên trong lúc chờ mạng thì tên mới bị ghi đè về tên cũ.
  //
  // Ca này phải đổi tên BÊN TRONG vòng mạng thì mới tất định: lúc đó `pushProject` đã đọc xong ảnh
  // chụp, nên nếu nó ghi đè bằng ảnh chụp cũ thì tên mới mất thật. Đổi tên trước khi gọi
  // `pushProject` thì ảnh chụp đã mang tên mới và test xanh kể cả khi code sai.
  it("đổi tên trong lúc chờ mạng thì tên mới không bị ghi đè về tên cũ", async () => {
    const { projectId } = await bootWorkspace(GUEST, { factory });

    const impl = (async () => {
      // Đổi tên rồi ép xuống đĩa ngay giữa vòng mạng, giống người dùng sửa tên khi Render free
      // đang ngủ 15 phút và lần gọi đầu mất hàng chục giây.
      useWorkspaceStore.getState().renameProject(projectId, "Tên Vừa Đổi");
      await flushWorkspace();
      return createdProject();
    }) as typeof fetch;

    await pushProject(projectId, { factory, fetchImpl: impl });

    // Đọc thẳng từ đĩa: tên mới phải còn nguyên.
    const db = await openWorkspaceDb(factory);
    const onDisk = await getRepository(db).getProject(projectId);
    db.close();
    expect(onDisk?.name).toBe("Tên Vừa Đổi");
    expect(onDisk?.cloud?.remoteId).toBe("remote-1");
  });

  // Cùng gốc lỗi: dự án bị xóa trong lúc chờ mạng thì ảnh chụp cũ làm nó sống lại với 0 tab.
  // Phải xóa ĐÚNG LÚC vòng mạng đang chạy — nếu xóa trước khi `pushProject` kịp đọc dự án thì
  // nó ném `LOCAL_NOT_FOUND` ở bước đọc và ca này không còn kiểm điều nó muốn kiểm.
  it("xóa dự án trong lúc chờ mạng thì dự án không sống lại", async () => {
    const { projectId } = await bootWorkspace(GUEST, { factory });

    const impl = (async () => {
      // Xóa dự án ngay bên trong vòng mạng: lúc này `pushProject` đã đọc xong ảnh chụp.
      useWorkspaceStore.getState().deleteProject(projectId);
      return createdProject();
    }) as typeof fetch;

    // Bản cloud vẫn được tạo, nhưng dự án local đã biến mất: phải báo lỗi, không báo "đã lưu".
    await expect(pushProject(projectId, { factory, fetchImpl: impl })).rejects.toMatchObject({
      code: "LOCAL_NOT_FOUND",
    });

    const db = await openWorkspaceDb(factory);
    const onDisk = await getRepository(db).getProject(projectId);
    db.close();
    expect(onDisk).toBeUndefined();
  });
});

describe("pushProject — ghi máy hỏng thì không đẩy bản cũ lên cloud", () => {
  // Reviewer vòng 3: `createAutosave.executeSave` nuốt lỗi vào `onError` nên `flush()` resolve dù
  // ghi hỏng. Ca "đĩa đầy" vẫn đẩy bản cũ lên cloud và báo `ok`.
  it("autosave ghi hỏng thì báo lỗi lưu máy và KHÔNG gửi request nào", async () => {
    // Bọc factory: mọi lượt ghi vào store `tabs` ném QuotaExceededError khi cờ bật. Cờ bật SAU
    // khi boot xong, để lúc dựng dữ liệu ban đầu vẫn ghi bình thường.
    const flag = { broken: false };
    const realOpen = factory.open.bind(factory);
    const sabotaged = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        const req = realOpen(...args);
        req.addEventListener("success", () => {
          const opened = req.result;
          const realTx = opened.transaction.bind(opened);
          opened.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
            const tx = realTx(names, mode);
            if (mode !== "readwrite") return tx;
            const realStore = tx.objectStore.bind(tx);
            tx.objectStore = ((name: string) => {
              const s = realStore(name);
              if (name === "tabs" && flag.broken) {
                s.put = (() => {
                  throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                }) as IDBObjectStore["put"];
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { projectId, tabId } = await bootWorkspace(GUEST, { factory: sabotaged });
    flag.broken = true;
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'ban moi nhat'");

    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return createdProject();
    }) as typeof fetch;

    await expect(pushProject(projectId, { factory: sabotaged, fetchImpl: impl })).rejects.toBeInstanceOf(
      CloudSyncError,
    );
    // Điểm chính: KHÔNG có request nào, vì đẩy lúc này là đẩy bản cũ.
    expect(calls).toBe(0);
  });
});
