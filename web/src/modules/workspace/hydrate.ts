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
   * thì `flushWorkspace()` trả về trước khi tên/engine/liên kết cloud xuống đĩa.
   *
   * KHÔNG dùng để nhớ "key nào còn nợ": việc đó do bước đối chiếu trong `flushWorkspace()` đo trực
   * tiếp từ đĩa và store. Xem chú thích ở đó để biết vì sao sổ nợ thủ công đã bị bỏ.
   */
  projectWrites: Set<Promise<void>>;
  /**
   * Kết quả lần `flushWorkspace()` gần nhất: đĩa có khớp store không.
   *
   * `false` cho tới lần đo đầu tiên — chưa đo thì chưa có bằng chứng.
   */
  diskMatchesStore: boolean;
  unsubscribe: () => void;
}

let currentSession: WorkspaceSession | null = null;
let bootLock: Promise<{ projectId: string; tabId: string }> | null = null;
/**
 * Trần chờ các lượt ghi còn đang chạy khi đóng phiên, xem `disposeWorkspace`.
 *
 * Phải LỚN HƠN `FLUSH_BUDGET_MS` dùng trong `disposeWorkspace`: nếu nhỏ hơn, lần thử lại bị cắt
 * giữa chừng và bản ghi đã xoá sống lại sau F5 — reviewer vòng 8 đo được đúng triệu chứng đó với
 * cặp 1500/2000.
 */
const DISPOSE_WRITE_TIMEOUT_MS = 3000;

/**
 * Ép mọi thay đổi đang chờ xuống IndexedDB rồi mới trả về.
 *
 * Ném lỗi khi đĩa không khớp store: bên gọi (đẩy lên cloud) phải dừng, vì đọc tiếp sẽ ra bản cũ mà
 * vẫn tưởng là bản mới nhất.
 *
 * ## Vì sao không dùng "sổ nợ"
 *
 * Các bản trước giữ những tập `failedWrites`/`failedDeletes`/`failedKeys` để nhớ "key nào còn nợ".
 * Cách đó sinh lỗi mới ở 5/8 vòng review, vì mỗi tập là một bản sao thủ công của một sự thật đã có
 * sẵn: **đĩa có khớp store hay không**. Bản sao đó phải được cập nhật đúng ở mọi đường (ghi xong,
 * xoá bản ghi, huỷ, đổi phiên), và mỗi đường bị bỏ sót là một lỗi kẹt vĩnh viễn hoặc một lần đẩy
 * bản cũ lên cloud.
 *
 * Ở đây sự thật được ĐO LẠI từ dữ liệu: đọc store, đọc đĩa, ghi lại chỗ lệch, rồi đọc lại để xác
 * nhận. Không có tập nào để quên cập nhật, nên không có đường nào làm nó kẹt. Và vì mỗi lần ghi
 * đều lấy giá trị HIỆN TẠI từ store, một lượt ghi cũ chạy muộn không thể đè bản mới bằng ảnh chụp
 * cũ — đúng hai lỗi mà reviewer vòng 8 đo được ở bản dùng sổ nợ.
 */
export async function flushWorkspace(target?: WorkspaceSession): Promise<void> {
  const session = target ?? currentSession;
  if (!session) return;
  const deadline = Date.now() + FLUSH_BUDGET_MS;

  // 1. Đẩy phần đang chờ của tab xuống đĩa. Lỗi ở bước này KHÔNG phải là phán quyết cuối, vì bước
  //    đối chiếu phía sau sẽ ghi lại chỗ lệch và tự kiểm bằng cách đọc lại đĩa.
  //
  //    Hết hạn ở bước này chỉ có nghĩa "chưa chờ xong", KHÔNG phải "đĩa hỏng": một transaction treo
  //    vẫn có thể đã ghi xong. Nên không ném ở đây mà để bước đối chiếu kết luận bằng số đo — nếu nó
  //    cũng không ghi được thì mới ném.
  await raceWithDeadline(session.tabAutosave.flush(), deadline, "Chờ ghi tab").catch(() => undefined);

  // 2. Hàng project ghi ngay nhưng bắn-và-quên; chờ các lượt đang chạy, có trần. Hết hạn thì bỏ
  //    qua — bước 3 sẽ ghi lại từ store, nên một lượt treo không làm mất dữ liệu.
  const inFlightProjects = Array.from(session.projectWrites);
  if (inFlightProjects.length > 0) {
    await raceWithDeadline(
      Promise.allSettled(inFlightProjects).then(() => undefined),
      deadline,
      "Chờ ghi project",
    ).catch(() => undefined);
  }

  // 3+4. Đối chiếu đĩa với store cho tới khi khớp hoặc hết ngân sách.
  for (;;) {
    const { blocking, leftover } = await reconcileOnce(session, deadline);
    if (blocking === 0) {
      // Đĩa đã có đủ và đúng phần store đang giữ → payload đẩy cloud sẽ đúng.
      session.diskMatchesStore = true;
      // Bản ghi ma còn sót thì thử dọn tiếp trong ngân sách, nhưng KHÔNG ném: nó không nằm trong
      // payload, và ném ở đây là khoá nút Lưu vì một tab đã xoá (reviewer vòng 6, lỗi 4a).
      if (leftover === 0 || Date.now() >= deadline) return;
      await delay(RETRY_PAUSE_MS);
      continue;
    }
    if (Date.now() >= deadline) {
      session.diskMatchesStore = false;
      throw new Error("Còn dữ liệu chưa ghi được xuống máy");
    }
    // Còn ngân sách: thử lại.
    await delay(RETRY_PAUSE_MS);
  }
}

/**
 * Một vòng đối chiếu: ghi lại mọi thứ store có mà đĩa thiếu/cũ, xoá mọi thứ đĩa có mà store không
 * còn. Trả về số chỗ còn lệch SAU khi ghi, tách làm hai loại.
 *
 * Idempotent: gọi lại bao nhiêu lần cũng được, và luôn ghi giá trị hiện tại của store nên không có
 * chuyện hồi sinh dữ liệu cũ.
 */
async function reconcileOnce(
  session: WorkspaceSession,
  deadline: number,
): Promise<{ blocking: number; leftover: number }> {
  const state = useWorkspaceStore.getState();
  const storeProjects = state.projects;
  const storeTabs = state.tabs;
  const repo = session.repo;

  // `blocking` = đĩa THIẾU hoặc CŨ hơn store → payload đẩy cloud sẽ sai, phải chặn Lưu.
  // `leftover` = đĩa THỪA bản ghi store không còn → chỉ là bản ghi ma; nó không nằm trong payload
  // nên nội dung đẩy lên vẫn đúng. Chặn Lưu vì nó là hồi quy thật: xoá một tab lúc đĩa hỏng sẽ
  // khoá nút Lưu vĩnh viễn (reviewer vòng 6 lỗi 4a, và bản viết lại này tái sinh đúng lỗi đó).
  let blocking = 0;
  let leftover = 0;

  // Đọc đĩa. Lỗi đọc cũng tính là lệch để vòng ngoài thử lại. Có trần: một transaction treo thì
  // `await` trần trụi sẽ treo luôn `flushWorkspace()` và do đó treo nút Lưu (reviewer vòng 8, lỗi 3).
  let diskProjects: WorkspaceProject[];
  let diskTabs: WorkspaceTab[];
  try {
    diskProjects = await guard(repo.listProjects(session.scope), deadline);
    const perProject = await guard(
      Promise.all(diskProjects.map((p) => repo.listTabs(p.id))),
      deadline,
    );
    diskTabs = perProject.flat();
  } catch {
    return { blocking: 1, leftover: 0 };
  }

  // Ghi lại chỗ thiếu hoặc cũ. Mỗi lượt lỗi chỉ tăng bộ đếm, không ném: vòng ngoài quyết định.
  for (const project of storeProjects) {
    if (Date.now() >= deadline) return { blocking: blocking + 1, leftover };
    const onDisk = diskProjects.find((p) => p.id === project.id);
    if (!onDisk || projectDiffers(onDisk, project)) {
      try {
        await guard(repo.upsertProject(project), deadline);
      } catch {
        blocking += 1;
      }
    }
  }
  for (const tab of storeTabs) {
    if (Date.now() >= deadline) return { blocking: blocking + 1, leftover };
    const onDisk = diskTabs.find((t) => t.id === tab.id);
    if (!onDisk || tabDiffers(onDisk, tab)) {
      try {
        await guard(repo.upsertTab(tab), deadline);
      } catch {
        blocking += 1;
      }
    }
  }

  // Xoá bản ghi ma: có trên đĩa nhưng store không còn. Để lại thì sau F5 nó sống lại và có thể
  // thành tab đang mở, nên vẫn phải thử lại — nhưng không chặn Lưu.
  for (const onDisk of diskProjects) {
    if (Date.now() >= deadline) return { blocking, leftover: leftover + 1 };
    if (!storeProjects.some((p) => p.id === onDisk.id)) {
      try {
        await guard(repo.deleteProjectCascade(onDisk.id), deadline);
      } catch {
        leftover += 1;
      }
    }
  }
  for (const onDisk of diskTabs) {
    if (Date.now() >= deadline) return { blocking, leftover: leftover + 1 };
    if (!storeTabs.some((t) => t.id === onDisk.id)) {
      try {
        await guard(repo.deleteTab(onDisk.id), deadline);
      } catch {
        leftover += 1;
      }
    }
  }

  // Xác nhận bằng cách ĐỌC LẠI: ghi không ném lỗi vẫn có thể không xuống đĩa (transaction abort muộn,
  // quota chặn giữa chừng). Chỉ tin số đo, không tin lời hứa của lượt ghi.
  if (blocking > 0 || leftover > 0) return { blocking, leftover };
  try {
    const afterProjects = await guard(repo.listProjects(session.scope), deadline);
    const afterPerProject = await guard(
      Promise.all(afterProjects.map((p) => repo.listTabs(p.id))),
      deadline,
    );
    const afterTabs = afterPerProject.flat();
    // Thiếu/cũ → chặn. Thừa → chỉ là ma, không chặn.
    if (afterProjects.length < storeProjects.length || afterTabs.length < storeTabs.length) {
      return { blocking: 1, leftover: 0 };
    }
    for (const project of storeProjects) {
      const onDisk = afterProjects.find((p) => p.id === project.id);
      if (!onDisk || projectDiffers(onDisk, project)) return { blocking: 1, leftover: 0 };
    }
    for (const tab of storeTabs) {
      const onDisk = afterTabs.find((t) => t.id === tab.id);
      if (!onDisk || tabDiffers(onDisk, tab)) return { blocking: 1, leftover: 0 };
    }
    if (afterProjects.length > storeProjects.length || afterTabs.length > storeTabs.length) {
      return { blocking: 0, leftover: 1 };
    }
  } catch {
    return { blocking: 1, leftover: 0 };
  }
  return { blocking: 0, leftover: 0 };
}

/**
 * Chờ một thao tác IndexedDB nhưng không quá `deadline`.
 *
 * Không có lớp này thì mọi `await` trên transaction treo sẽ treo `flushWorkspace()`, và vì
 * `pushProject` gọi nó nên nút Lưu treo vĩnh viễn — reviewer vòng 8 đo được 8001 ms không trả về.
 */
function guard<T>(work: Promise<T>, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new Error("Hết hạn"));
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Hết hạn")), left)),
  ]);
}

/** Trần thời gian cho cả một lần `flushWorkspace()`, gồm chờ lượt đang bay và các vòng đối chiếu. */
const FLUSH_BUDGET_MS = 2000;
/** Nghỉ giữa hai vòng đối chiếu, tránh quay nóng khi đĩa hỏng liên tục. */
const RETRY_PAUSE_MS = 100;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chờ `work` nhưng không quá `deadline` tính từ bây giờ.
 *
 * Transaction IndexedDB có thể treo vĩnh viễn (tab bị đóng, db bị block bởi tab khác đang mở bản
 * cũ), và `pushProject` gọi `flushWorkspace()` nên treo ở đây là treo luôn nút Lưu. Hết hạn thì
 * ném để bước đối chiếu phía sau quyết định bằng dữ liệu thật.
 */
async function raceWithDeadline(work: Promise<void>, deadline: number, what: string): Promise<void> {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error(`${what}: hết hạn`);
  await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${what}: hết hạn`)), left)),
  ]);
}

/** Hai bản ghi project có khác nhau ở trường nào được ghi xuống đĩa không. */
function projectDiffers(a: WorkspaceProject, b: WorkspaceProject): boolean {
  return (
    a.name !== b.name ||
    a.engine !== b.engine ||
    a.updatedAt !== b.updatedAt ||
    a.cloud?.remoteId !== b.cloud?.remoteId ||
    a.cloud?.remoteUpdatedAt !== b.cloud?.remoteUpdatedAt ||
    a.cloud?.stamp !== b.cloud?.stamp
  );
}

/** Hai bản ghi tab có khác nhau ở trường nào được ghi xuống đĩa không. */
function tabDiffers(a: WorkspaceTab, b: WorkspaceTab): boolean {
  return a.name !== b.name || a.sql !== b.sql || a.position !== b.position || a.updatedAt !== b.updatedAt;
}

/**
 * Còn dữ liệu nào chưa xuống đĩa không.
 *
 * Trả về kết quả của lần `flushWorkspace()` GẦN NHẤT, do chính bước đối chiếu đo được. Không suy ra
 * từ cờ trạng thái nào của store: `saveState` bị đặt về `idle` bởi BẤT KỲ lượt ghi thành công nào
 * — kể cả của key khác — nên nó không chứng minh được mọi thứ đã xuống đĩa.
 *
 * Mặc định là `true` trước lần đo đầu tiên: chưa đo thì chưa có bằng chứng, và thà chặn nhầm một
 * lần Lưu còn hơn đẩy bản cũ lên cloud rồi báo thành công.
 */
export function hasUnflushedFailures(): boolean {
  if (!currentSession) return false;
  return !currentSession.diskMatchesStore;
}

export async function disposeWorkspace(): Promise<void> {
  if (currentSession) {
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
        // Đối chiếu lần cuối trước khi đóng db: lượt ghi/xoá nào còn hỏng thì bản ghi ma sẽ nằm lại
        // trên đĩa và SỐNG LẠI sau F5 (reviewer vòng 7 và vòng 8 đều đo được `ghostAliveAfterF5`).
        // Dùng cùng bước đối chiếu với `flushWorkspace()` nên không có sổ nợ nào để quên.
        try {
          await flushWorkspace(session);
        } catch {
          // Hết ngân sách mà đĩa vẫn lệch: đóng db và đi tiếp. Dữ liệu chưa xuống được thì đã mất
          // từ trước, chờ thêm không cứu được, mà treo ở đây là treo cả lần boot sau.
        }
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
    // Giữ lại promise GỐC trong `projectWrites` để `flushWorkspace()` chờ các lượt đang chạy.
    //
    // KHÔNG có sổ nợ ở đây: lượt ghi hỏng thì `flushWorkspace()` phát hiện bằng cách đối chiếu đĩa
    // với store, nên không cần nhớ key nào đã hỏng — và do đó cũng không có tập nào để quên cập nhật.
    const projectWrites = new Set<Promise<void>>();

    /**
     * Ghi một hàng project xuống đĩa, bắn-và-quên.
     *
     * `run` được gọi lại mỗi lần, không phải promise sẵn: bước đối chiếu trong `flushWorkspace()`
     * tự gọi `repo.upsertProject(project)` với giá trị HIỆN TẠI của store, nên nó không cần giữ
     * closure của lượt ghi cũ — chính closure cũ là thứ reviewer vòng 8 đo được là ghi đè bản mới
     * bằng ảnh chụp cũ.
     */
    const trackProjectWrite = (run: () => Promise<void>) => {
      const p = run();
      projectWrites.add(p);
      void p.catch(() => undefined).finally(() => projectWrites.delete(p));
      void p.catch((err: unknown) => {
        useWorkspaceStore.getState().setSaveState("error", err instanceof Error ? err.message : String(err));
      });
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
          trackProjectWrite(() => repo!.deleteTab(prev.id));
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
          trackProjectWrite(() => repo!.upsertProject(proj));
        }
      }

      // Projects: xóa project kéo theo xóa các tab
      for (const prev of lastProjects) {
        if (!state.projects.some((p) => p.id === prev.id)) {
          // Tab của project vừa xóa cũng phải hủy phần đang chờ ghi, cùng lý do như trên.
          for (const tab of lastTabs) {
            if (tab.projectId === prev.id) tabAutosave.cancel(tab.id);
          }
          // Không cần xoá "khoản nợ" nào của project này: bước đối chiếu so đĩa với store, mà
          // project đã rời store thì nó chỉ còn là bản ghi ma — bước đó sẽ xoá nó khỏi đĩa. Không
          // có tập trạng thái nào để quên dọn, nên không có đường nào làm nút Lưu kẹt vĩnh viễn.
          trackProjectWrite(() => repo!.deleteProjectCascade(prev.id));
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
      diskMatchesStore: false,
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
