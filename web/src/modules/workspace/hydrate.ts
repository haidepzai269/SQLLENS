// Khởi động và đồng bộ workspace cục bộ với IndexedDB.
// Không gửi request mạng nào mang nội dung SQL (Core Rule 7).

import { createAutosave, type Autosave } from "./autosave";
import { openWorkspaceDb } from "./db";
import { clearPendingProject, peekPendingProject } from "./pending-project";
import { getRepository, type WorkspaceRepository } from "./repository";
import { useWorkspaceStore } from "./store";
import {
  scopeKey,
  type WorkspaceProject,
  type WorkspaceScope,
  type WorkspaceTab,
} from "./types";

export interface BootWorkspaceOptions {
  factory?: IDBFactory;
  initialSql?: string;
  delayMs?: number;
  /** Nguồn id dự án cần mở (Fork từ /share ghi vào sessionStorage); test truyền storage giả. */
  sessionStorage?: Storage;
}

interface WorkspaceSession {
  scope: WorkspaceScope;
  db: IDBDatabase;
  repo: WorkspaceRepository;
  tabAutosave: Autosave<WorkspaceTab>;
  /**
   * Hàng project ghi ngay (không debounce) nhưng bắn-và-quên. Phải theo dõi riêng: không có nó
   * thì `flushWorkspace()` trả về trước khi tên/engine/liên kết cloud xuống đĩa, và `pushProject`
   * đọc ra bản cũ rồi ghi đè mất bản mới.
   */
  projectWrites: Set<Promise<void>>;
  /**
   * Số lượt ghi hàng project đã HỎNG và chưa được sửa bằng một lượt ghi thành công sau đó.
   *
   * Cần riêng khỏi `projectWrites`: promise hỏng đã settle thì rời khỏi Set, nên
   * `flushWorkspace()` không còn thấy nó. Không có bộ đếm này thì "đổi tên khi đĩa đầy rồi bấm
   * Lưu" sẽ đẩy tên CŨ lên cloud và báo thành công — vế còn hở của N1 (reviewer vòng 5, R1).
   */
  failedWrites: Set<string>;
  unsubscribe: () => void;
}

let currentSession: WorkspaceSession | null = null;
let bootLock: Promise<{ projectId: string; tabId: string }> | null = null;
/** Trần chờ các lượt ghi project khi đóng phiên, xem `disposeWorkspace`. */
const DISPOSE_WRITE_TIMEOUT_MS = 1500;

/**
 * Ép mọi thay đổi đang chờ xuống IndexedDB rồi mới trả về.
 *
 * Ném lỗi khi có lần ghi hỏng: bên gọi (đẩy lên cloud) phải dừng, vì đọc tiếp sẽ ra bản cũ mà
 * vẫn tưởng là bản mới nhất. Trước đây hàm này nuốt lỗi nên "gõ rồi lưu ngay" vẫn đẩy bản cũ
 * khi đĩa đầy.
 */
export async function flushWorkspace(): Promise<void> {
  if (!currentSession) return;
  const session = currentSession;

  await session.tabAutosave.flushStrict();
  // Hàng project ghi ngay nhưng không await; chờ hết các lượt đang chạy.
  const pendingProjects = Array.from(session.projectWrites);
  if (pendingProjects.length > 0) {
    const results = await Promise.allSettled(pendingProjects);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  // Lượt ghi ĐÃ hỏng từ trước (không còn trong `projectWrites` vì promise đã settle) vẫn phải
  // làm ném: nếu không, "đổi tên khi đĩa đầy rồi bấm Lưu" sẽ đẩy tên cũ lên cloud và báo thành
  // công. Đây là vế còn hở của N1 — `flushStrict` chỉ biết key của tab, không biết hàng project.
  if (session.failedWrites.size > 0) {
    throw new Error("Còn dữ liệu chưa ghi được xuống máy");
  }
}

/**
 * Còn dữ liệu nào chưa xuống đĩa vì một lượt ghi trước đã hỏng không.
 *
 * Dùng thay cho việc đọc `saveState` của store: `saveState` bị đặt về `idle` bởi BẤT KỲ lượt ghi
 * thành công nào — kể cả của tab khác — nên nó không chứng minh được mọi thứ đã xuống đĩa.
 */
export function hasUnflushedFailures(): boolean {
  if (!currentSession) return false;
  return currentSession.tabAutosave.hasPendingFailures() || currentSession.failedWrites.size > 0;
}

export async function disposeWorkspace(): Promise<void> {  if (currentSession) {
    const session = currentSession;
    currentSession = null;
    session.unsubscribe();
    // Lượt ghi còn đang chạy phải xong trước khi đóng db, nếu không nó ném InvalidStateError và
    // thay đổi cuối cùng mất mà không ai báo.
    //
    // Nhưng phải có trần thời gian: một transaction IndexedDB có thể treo vĩnh viễn (tab bị đóng,
    // db bị block bởi tab khác đang mở bản cũ), và `bootWorkspace` gọi hàm này trước khi mở phiên
    // mới — treo ở đây là treo cả ứng dụng. Chờ quá hạn thì đóng db và đi tiếp; dữ liệu chưa ghi
    // xong đã mất từ trước đó rồi, chờ thêm không cứu được.
    //
    // Trần phải bọc CẢ `tabAutosave.dispose()`: hàm đó `flush()` rồi `await Promise.all(inFlight)`
    // không có hạn, nên một transaction tab treo vẫn treo y như transaction project — đúng lỗi mà
    // trần này sinh ra để chặn. Trước đây chỉ bọc `projectWrites`, đo được TAB_HANG vẫn treo 6 s.
    await Promise.race([
      (async () => {
        await session.tabAutosave.dispose();
        await Promise.allSettled(Array.from(session.projectWrites));
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_WRITE_TIMEOUT_MS)),
    ]);
    try {
      session.db.close();
    } catch {
      // db có thể đã đóng
    }
  }
}

export async function bootWorkspace(
  scope: WorkspaceScope = { kind: "guest" },
  options?: BootWorkspaceOptions,
): Promise<{ projectId: string; tabId: string }> {
  // Tránh xung đột nếu gọi boot đồng thời
  if (bootLock) {
    try {
      await bootLock;
    } catch {
      // bỏ qua lỗi của lần boot trước
    }
  }

  const execution = (async () => {
    // Dọn dẹp session cũ nếu có
    await disposeWorkspace();

    let db: IDBDatabase | null = null;
    let repo: WorkspaceRepository | null = null;

    try {
      db = await openWorkspaceDb(options?.factory);
      repo = getRepository(db);
    } catch (err) {
      // Ca biên: IndexedDB bị chặn (chế độ riêng tư) hoặc môi trường không hỗ trợ.
      // Fallback in-memory: khởi tạo dự án tạm trong RAM, cảnh báo thân thiện và không crash.
      const now = Date.now();
      const fallbackProject: WorkspaceProject = {
        id: crypto.randomUUID(),
        scopeKey: scopeKey(scope),
        name: "Mặc định",
        engine: "postgres",
        createdAt: now,
        updatedAt: now,
      };
      const fallbackTab: WorkspaceTab = {
        id: crypto.randomUUID(),
        projectId: fallbackProject.id,
        name: "Query 1",
        sql: options?.initialSql ?? "",
        position: 0,
        updatedAt: now,
      };

      const store = useWorkspaceStore.getState();
      store.setScope(scope);
      store.hydrate({
        projects: [fallbackProject],
        tabs: [fallbackTab],
        activeProjectId: fallbackProject.id,
        activeTabId: fallbackTab.id,
      });
      store.setSaveState("error", err instanceof Error ? err.message : String(err));

      return { projectId: fallbackProject.id, tabId: fallbackTab.id };
    }

    // 1. Nạp danh sách project theo scope
    let projects = await repo.listProjects(scope);
    let tabs: WorkspaceTab[] = [];
    let activeProjectId: string;
    let activeTabId: string;

    if (projects.length === 0) {
      // AC2: Lần mở đầu tiên tự tạo đúng 1 project "Mặc định" + 1 tab "Query 1"
      const now = Date.now();
      const defaultProject: WorkspaceProject = {
        id: crypto.randomUUID(),
        scopeKey: scopeKey(scope),
        name: "Mặc định",
        engine: "postgres",
        createdAt: now,
        updatedAt: now,
      };
      const defaultTab: WorkspaceTab = {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        name: "Query 1",
        sql: options?.initialSql ?? "",
        position: 0,
        updatedAt: now,
      };

      await repo.upsertProject(defaultProject);
      await repo.upsertTab(defaultTab);

      projects = [defaultProject];
      tabs = [defaultTab];
      activeProjectId = defaultProject.id;
      activeTabId = defaultTab.id;
    } else {
      // Đã có project: nạp toàn bộ tab của các project trong scope
      const tabLists = await Promise.all(projects.map((p) => repo!.listTabs(p.id)));
      tabs = tabLists.flat();

      // Fork từ /share ghi lại id dự án vừa tạo; chỉ mở và chỉ dọn khi nó thuộc scope đang nạp.
      // Lab boot hai lần (guest trước, user sau khi /api/me xong), nên lần boot không khớp scope
      // phải giữ nguyên dấu chờ cho lần sau.
      const pending = peekPendingProject(options?.sessionStorage);
      if (pending && projects.some((p) => p.id === pending)) {
        activeProjectId = pending;
        clearPendingProject(pending, options?.sessionStorage);
      } else {
        activeProjectId = projects[0].id;
      }
      const activeProjectTabs = tabs.filter((t) => t.projectId === activeProjectId);

      if (activeProjectTabs.length === 0) {
        // Dự án chưa có tab nào (ca hiếm): tạo mới 1 tab mặc định
        const now = Date.now();
        const newTab: WorkspaceTab = {
          id: crypto.randomUUID(),
          projectId: activeProjectId,
          name: "Query 1",
          sql: options?.initialSql ?? "",
          position: 0,
          updatedAt: now,
        };
        await repo.upsertTab(newTab);
        tabs.push(newTab);
        activeTabId = newTab.id;
      } else {
        activeTabId = activeProjectTabs[0].id;
      }
    }

    // 2. Cập nhật vào Zustand store
    const store = useWorkspaceStore.getState();
    store.setScope(scope);
    store.hydrate({
      projects,
      tabs,
      activeProjectId,
      activeTabId,
    });

    // 3. Khởi tạo bộ autosave kết nối với IndexedDB
    const tabAutosave = createAutosave<WorkspaceTab>({
      delayMs: options?.delayMs ?? 300,
      save: async (_key, tab) => {
        useWorkspaceStore.getState().setSaveState("saving");
        await repo!.upsertTab(tab);
        useWorkspaceStore.getState().setSaveState("idle");
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        useWorkspaceStore.getState().setSaveState("error", message);
      },
    });

    let lastTabs = useWorkspaceStore.getState().tabs;
    let lastProjects = useWorkspaceStore.getState().projects;

    // 4. Lắng nghe store thay đổi để ghi vào IndexedDB
    //
    // Hàng project ghi ngay (không debounce) nhưng KHÔNG await được trong subscriber đồng bộ.
    // Giữ lại promise GỐC trong `projectWrites` để `flushWorkspace()` chờ và biết ghi hỏng;
    // phần báo trạng thái lỗi lên store gắn riêng, không nuốt mất lỗi của promise gốc.
    const projectWrites = new Set<Promise<void>>();
    // Key nào có lượt ghi hàng project đã hỏng và chưa ghi lại được. Phải theo TỪNG key: một lượt
    // ghi thành công của key khác không chứng minh gì về key này (cùng lý do như `failedKeys`
    // trong `autosave.ts`).
    const failedWrites = new Set<string>();
    const trackProjectWrite = (key: string, p: Promise<void>) => {
      projectWrites.add(p);
      void p.catch(() => undefined).finally(() => projectWrites.delete(p));
      void p.then(
        () => failedWrites.delete(key),
        (err) => {
          failedWrites.add(key);
          useWorkspaceStore.getState().setSaveState("error", err instanceof Error ? err.message : String(err));
        },
      );
    };

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      if (scopeKey(state.scope) !== scopeKey(scope)) return;

      // Tabs: cập nhật hoặc thêm mới qua autosave debounce
      for (const tab of state.tabs) {
        const prev = lastTabs.find((t) => t.id === tab.id);
        if (
          !prev ||
          prev.sql !== tab.sql ||
          prev.name !== tab.name ||
          prev.position !== tab.position ||
          prev.updatedAt !== tab.updatedAt
        ) {
          tabAutosave.schedule(tab.id, tab);
        }
      }

      // Tabs: xóa tab nếu đã bị gỡ khỏi store
      for (const prev of lastTabs) {
        if (!state.tabs.some((t) => t.id === prev.id)) {
          // Hủy phần đang chờ ghi của tab này trước, nếu không debounce sẽ ghi lại
          // tab vừa đóng và sau F5 nó sống lại.
          tabAutosave.cancel(prev.id);
          trackProjectWrite(`tab:${prev.id}`, repo!.deleteTab(prev.id));
        }
      }

      // Projects: thêm mới, đổi tên / engine, hoặc đổi liên kết cloud (Task154: lưu lên cloud
      // hay xóa trên cloud xong phải ghi xuống đĩa, nếu không F5 là liên kết cũ sống lại).
      for (const proj of state.projects) {
        const prev = lastProjects.find((p) => p.id === proj.id);
        if (
          !prev ||
          prev.name !== proj.name ||
          prev.engine !== proj.engine ||
          prev.updatedAt !== proj.updatedAt ||
          prev.cloud?.remoteId !== proj.cloud?.remoteId ||
          prev.cloud?.remoteUpdatedAt !== proj.cloud?.remoteUpdatedAt ||
          prev.cloud?.stamp !== proj.cloud?.stamp
        ) {
          trackProjectWrite(`project:${proj.id}`, repo!.upsertProject(proj));
        }
      }

      // Projects: xóa project kéo theo xóa các tab
      for (const prev of lastProjects) {
        if (!state.projects.some((p) => p.id === prev.id)) {
          // Tab của project vừa xóa cũng phải hủy phần đang chờ ghi, cùng lý do như trên.
          for (const tab of lastTabs) {
            if (tab.projectId === prev.id) tabAutosave.cancel(tab.id);
          }
          trackProjectWrite(`project:${prev.id}`, repo!.deleteProjectCascade(prev.id));
        }
      }

      lastTabs = state.tabs;
      lastProjects = state.projects;
    });

    currentSession = {
      scope,
      db,
      repo,
      tabAutosave,
      projectWrites,
      failedWrites,
      unsubscribe,
    };

    return { projectId: activeProjectId, tabId: activeTabId };
  })();

  bootLock = execution;
  try {
    return await execution;
  } finally {
    bootLock = null;
  }
}
