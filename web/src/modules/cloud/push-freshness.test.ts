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

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe("pushProject — tab đã đóng mà xoá hỏng không được lọt vào payload", () => {
  // Reviewer vòng 9, lỗi 3. `pushProject` đọc tab TỪ ĐĨA, và `flushWorkspace()` cố ý không chặn
  // Lưu khi còn bản ghi ma (chặn sẽ khoá nút Lưu vĩnh viễn — lỗi 4a vòng 6). Nên đĩa có thể còn
  // tab người dùng đã đóng, và nó bị đẩy lên cloud: nội dung tưởng đã xoá lại được gửi đi.
  // Đo được trước khi sửa: `payloadCoTabDaXoa=true sqlTrongPayload="|SELECT 'bi-mat-cua-toi'"`.
  it("tab đã đóng mà lệnh xoá hỏng thì payload KHÔNG được chứa nó", async () => {
    // Phải cài bẫy TRƯỚC `bootWorkspace`: nó mở kết nối IndexedDB và giữ nguyên, nên gắn bẫy lên
    // factory sau đó là vô hiệu (đã đo: `[GHOST] onDisk` vẫn thiếu tab ma vì lệnh xoá thành công).
    const arm = { broken: false };
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
              if (name === "tabs") {
                const realDelete = s.delete.bind(s);
                s.delete = ((k: IDBValidKey) => {
                  if (arm.broken) {
                    throw new DOMException("QuotaExceededError (giả lập)", "QuotaExceededError");
                  }
                  return realDelete(k);
                }) as IDBObjectStore["delete"];
              }
              return s;
            }) as IDBTransaction["objectStore"];
            return tx;
          }) as IDBDatabase["transaction"];
        });
        return req;
      },
    } as unknown as IDBFactory;

    const { projectId } = await bootWorkspace(GUEST, { factory: sabotaged });

    // Một tab có nội dung riêng tư, đã xuống đĩa.
    const secret = useWorkspaceStore.getState().createTab(projectId);
    useWorkspaceStore.getState().updateTabSql(secret.id, "SELECT 'bi-mat-cua-toi'");
    await flushWorkspace();

    // Từ đây lệnh xoá hỏng: đóng tab sẽ để lại bản ghi ma trên đĩa.
    arm.broken = true;
    useWorkspaceStore.getState().closeTab(secret.id);
    await waitMs(60);
    // Lưu phải thành công (không khoá nút Lưu vì một tab đã xoá) — nhưng payload phải sạch.
    await expect(flushWorkspace()).resolves.toBeUndefined();

    // Xác nhận đúng là bản ghi ma còn trên đĩa, nếu không test đang kiểm tình huống khác.
    const db = await openWorkspaceDb(sabotaged);
    try {
      const onDisk = await getRepository(db).listTabs(projectId);
      expect(onDisk.some((t) => t.id === secret.id)).toBe(true);
    } finally {
      db.close();
    }

    let sent: { tabs?: Array<{ sql: string }> } | undefined;
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = init?.body ? (JSON.parse(String(init.body)) as typeof sent) : undefined;
      return createdProject();
    }) as typeof fetch;

    await pushProject(projectId, { factory: sabotaged, fetchImpl: impl });

    expect(sent?.tabs ?? []).not.toContainEqual(
      expect.objectContaining({ sql: expect.stringContaining("bi-mat") }),
    );
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

  // Reviewer vòng 4 (N1): `flushStrict()` chỉ thấy lỗi của CHÍNH nó. Đĩa đầy từ lúc đang gõ thì
  // lượt debounce hỏng, `pending` rỗng, và lúc bấm Lưu không có gì để ghi nên "thành công" —
  // trong khi IndexedDB vẫn giữ bản cũ. Đo được: `KET_QUA_PUSH: ok`, `PAYLOAD_SQL: ""`.
  it("đĩa đã hỏng từ lúc đang gõ thì bấm Lưu phải báo lỗi, không đẩy bản cũ", async () => {
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

    // `delayMs: 10` để lượt ghi debounce chạy và hỏng TRƯỚC khi người dùng bấm Lưu. Với mặc
    // định 300 ms thì lúc bấm Lưu phần ghi vẫn còn trong `pending`, và ca này sẽ rơi vào đường
    // của F3 (flush ghi hỏng) chứ không kiểm được cửa sổ mà N1 nói tới.
    const { projectId, tabId } = await bootWorkspace(GUEST, { factory: sabotaged, delayMs: 10 });
    flag.broken = true;
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'ban moi nhat'");

    // Đợi debounce chạy và hỏng: lúc này `pending` rỗng, `saveState` là "error".
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(useWorkspaceStore.getState().saveState).toBe("error");

    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return createdProject();
    }) as typeof fetch;

    await expect(pushProject(projectId, { factory: sabotaged, fetchImpl: impl })).rejects.toBeInstanceOf(
      CloudSyncError,
    );
    expect(calls).toBe(0);
  });

  // Reviewer vòng 5 (R1), kịch bản A: hàng project ghi hỏng, rồi một TAB ghi thành công. Bản sửa
  // vòng 4 dùng `saveState` của store, mà `saveState` bị đặt về "idle" sau MỌI lượt ghi thành
  // công — kể cả của tab khác. Nên tên mới chưa xuống đĩa nhưng vẫn bị đẩy tên cũ lên cloud.
  it("R1a: hàng project ghi hỏng rồi tab khác ghi được thì vẫn KHÔNG được đẩy bản cũ", async () => {
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
              if (name === "projects" && flag.broken) {
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

    const { projectId, tabId } = await bootWorkspace(GUEST, { factory: sabotaged, delayMs: 10 });

    // Đổi TÊN: hàng project ghi hỏng.
    flag.broken = true;
    useWorkspaceStore.getState().renameProject(projectId, "Tên Chưa Xuống Đĩa");
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Rồi sửa một TAB: lượt ghi này thành công và (theo cách cũ) xóa sạch dấu lỗi.
    // Cờ `broken` giữ nguyên: chỉ store `projects` bị hỏng, nên lượt ghi TAB vẫn thành công — đúng
    // điều kiện cần để test này đo được điều nó định đo.
    useWorkspaceStore.getState().updateTabSql(tabId, "SELECT 'tab ghi duoc'");
    await new Promise((resolve) => setTimeout(resolve, 60));

    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return createdProject();
    }) as typeof fetch;

    // Phải DỪNG: đĩa vẫn hỏng nên tên mới chưa xuống đĩa, đẩy lúc này là đẩy bản cũ.
    await expect(pushProject(projectId, { factory: sabotaged, fetchImpl: impl })).rejects.toBeInstanceOf(
      CloudSyncError,
    );
    expect(calls).toBe(0);
  });

  // Vế còn lại của cùng kịch bản, sau khi có đường thử lại (reviewer vòng 7, N3): đĩa HỒI thì lần
  // Lưu phải thử lại, đẩy được, và payload phải mang TÊN MỚI — không phải tên cũ. Đây mới là bất
  // biến thật: không bao giờ đẩy bản cũ trong khi store giữ bản mới.
  it("R1b: đĩa hồi thì đẩy được, và payload mang tên MỚI chứ không phải tên cũ", async () => {
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
              if (name === "projects" && flag.broken) {
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

    const { projectId } = await bootWorkspace(GUEST, { factory: sabotaged, delayMs: 10 });

    flag.broken = true;
    useWorkspaceStore.getState().renameProject(projectId, "TEN-MOI-DA-XUONG-DIA");
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Đĩa hồi.
    flag.broken = false;

    let body: string | undefined;
    const impl = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return createdProject();
    }) as unknown as typeof fetch;

    await expect(pushProject(projectId, { factory: sabotaged, fetchImpl: impl })).resolves.toBeDefined();
    expect(body).toContain("TEN-MOI-DA-XUONG-DIA");
  });
});
