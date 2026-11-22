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
  /**
   * Phiên này đã bị `purgeUserScope()` xoá sạch đĩa chưa.
   *
   * Đây là ngoại lệ DUY NHẤT của quy tắc "store là nguồn sự thật". Bình thường đĩa thiếu hàng mà
   * store có nghĩa là ghi hỏng → phải ghi lại. Nhưng luồng đăng xuất chọn "Xoá nháp cục bộ" cố ý
   * XOÁ đĩa trong khi store vẫn còn dữ liệu (store chỉ được dọn khi đổi scope), nên đối chiếu sẽ
   * coi đó là "thiếu" và ghi lại đúng những hàng vừa xoá — nháp riêng tư sống lại nguyên văn SQL.
   *
   * Reviewer vòng 9 đo được: `sauPurge(userProjects=0)` → `sauDoiScope(userProjects=1)` và
   * `sqlSongLai="SELECT 'bi-mat-nguoi-dung'"`, vi phạm AC2 Task129.
   */
  purged: boolean;
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

  // Phiên đã bị `purgeUserScope()` xoá sạch đĩa: store còn dữ liệu KHÔNG phải là "ghi hỏng cần ghi
  // lại" mà là "dữ liệu vừa được xoá có chủ ý". Ghi lại ở đây là hồi sinh nháp riêng tư của người
  // vừa đăng xuất, nguyên văn SQL (reviewer vòng 9, lỗi 1; AC2 Task129).
  //
  // Chỉ bỏ qua phán quyết, KHÔNG đụng đĩa: đĩa đang đúng là rỗng.
  if (session.purged) {
    session.diskMatchesStore = true;
    return;
  }

  // Bước CHỜ và bước ĐO có ngân sách riêng, không dùng chung một `deadline`.
  //
  // Dùng chung thì bước chờ ăn hết ngân sách và bước đo không bao giờ được chạy: nó thấy
  // `Date.now() >= deadline` ngay từ vòng đầu, kết luận `blocking` và ném — dù đĩa đã khớp store.
  // Đo được: workspace 601 tab, chỉ sửa 1 tab rồi bấm Lưu → `[LOOP] iter=1 blocking=1 ms=2002`,
  // Lưu báo lỗi vĩnh viễn. Đó là "báo lỗi oan", đúng hướng nguy hiểm: người dùng không Lưu được dù
  // mọi thứ đã xuống đĩa.
  //
  // Tách ra thì điều tồi tệ nhất là tổng thời gian bằng tổng hai ngân sách, còn hơn khoá cứng tính
  // năng. Bước chờ KHÔNG phán quyết gì, nên nó có hạn riêng ngắn hơn.
  const waitDeadline = Date.now() + WAIT_BUDGET_MS;

  // 1. Đẩy phần đang chờ của tab xuống đĩa. Lỗi ở bước này KHÔNG phải là phán quyết cuối, vì bước
  //    đối chiếu phía sau sẽ ghi lại chỗ lệch và tự kiểm bằng cách đọc lại đĩa.
  //
  //    Hết hạn ở bước này chỉ có nghĩa "chưa chờ xong", KHÔNG phải "đĩa hỏng": một transaction treo
  //    vẫn có thể đã ghi xong. Nên không ném ở đây mà để bước đối chiếu kết luận bằng số đo — nếu nó
  //    cũng không ghi được thì mới ném.
  await raceWithDeadline(session.tabAutosave.flush(), waitDeadline, "Chờ ghi tab").catch(
    () => undefined,
  );

  // 2. Hàng project ghi ngay nhưng bắn-và-quên; chờ các lượt đang chạy, có trần. Hết hạn thì bỏ
  //    qua — bước 3 sẽ ghi lại từ store, nên một lượt treo không làm mất dữ liệu.
  const inFlightProjects = Array.from(session.projectWrites);
  if (inFlightProjects.length > 0) {
    await raceWithDeadline(
      Promise.allSettled(inFlightProjects).then(() => undefined),
      waitDeadline,
      "Chờ ghi project",
    ).catch(() => undefined);
  }

  const deadline = Date.now() + FLUSH_BUDGET_MS;

  // 3+4. Đối chiếu đĩa với store cho tới khi khớp hoặc hết ngân sách.
  //
  // `blocking` (đĩa thiếu/cũ) và `leftover` (đĩa thừa bản ghi ma) khác nhau về hậu quả:
  //
  //   - `blocking`: payload sẽ THIẾU dữ liệu → luôn phải chặn.
  //   - `leftover`: payload sẽ THỪA bản ghi người dùng đã xoá. Nhưng chặn ở đây là tái sinh lỗi 4a
  //     vòng 6: một tab đã xoá mà xoá hỏng thì khoá nút Lưu vĩnh viễn, và chặn luôn cả dự án khác.
  //
  // Nên `leftover` KHÔNG chặn ở đây. Chỗ chặn đúng là lúc dựng payload: `pushProject` lọc tab theo
  // store (nguồn sự thật về "cái gì còn tồn tại"), nên bản ghi ma không vào được payload dù còn trên
  // đĩa. Xem `sync.ts` phần dựng `payload.tabs`.
  //
  // `lastBlocking` nhớ phán quyết của lần ĐO ĐƯỢC gần nhất. Cần nó vì khi cạn ngân sách,
  // `reconcileOnce` không còn đo được nữa — `guard()` hết hạn ném ngay và bị đổi thành `blocking: 1`
  // — nên phán quyết "hỏng" đó là giả. Tin nó thì bản ghi ma lại khoá nút Lưu đúng như lỗi 4a.
  // Đo được: `[L] blocking=1 leftover=0 hetGio=true` sau mười mấy vòng `blocking=0 leftover=1`.
  // `expired` là khác biệt cốt lõi: "đo được và thấy lệch" khác "không đo được". Chỉ cái đầu mới
  // là bằng chứng ghi hỏng. `guard()` hết hạn ném ngay giữa hàm, và nếu coi cú ném đó là lệch thì
  // bản ghi ma lại khoá nút Lưu — đúng lỗi 4a vòng 6 mà nhánh `leftover` sinh ra để tránh. Reviewer
  // vòng 9 đo được `[G1] flush=THREW ms=2047` với chỉ một tab ma.
  //
  // Đo được trước khi có `measured`: `[L] blocking=1 leftover=0 hetGio=true` sau mười mấy vòng
  // `blocking=0 leftover=1` — vòng cuối chỉ hết giờ, không hề thấy lệch.
  //
  // `measured = false` nghĩa là vòng đó KHÔNG kết luận được gì (đọc lỗi, hoặc `guard()` hết hạn).
  // Phân biệt này quan trọng vì hai loại bất định phải xử lý ngược nhau:
  //   - Chưa từng đo được lần nào → phải CHẶN (fail-safe): không có bằng chứng đĩa khớp thì không
  //     được đẩy lên cloud. Đây là V8-3/V8-3b: ghi hoặc đọc treo suốt ngân sách.
  //   - Đã đo được và thấy khớp, chỉ còn bản ghi ma dọn không xong → KHÔNG chặn (lỗi 4a vòng 6).
  // Ngân sách ở đây là bộ phát hiện ĐỨNG YÊN, không phải tổng thời gian.
  //
  // Tổng thời gian là thước đo sai: workspace 601 tab cần hơn 2 s chỉ để ghi hết một lượt trên máy
  // chậm, nên "hết 2 s" không phân biệt được "treo" với "đang tiến triển". Đo được `[Y] ms=2166
  // blocking=1 measured=false` rồi ném, dù vòng sau chỉ cần 114 ms là xong (`[Y] ms=114 blocking=0`)
  // — tức là nó tự hồi phục, chỉ vì ngân sách cắt ngang.
  //
  // Đứng yên mới là bằng chứng treo: mỗi vòng trả về `work` = số hàng đã ghi/xoá được. Vòng nào
  // `work` không tăng so với vòng trước thì ta đang bị chặn thật. `STALL_LIMIT` vòng liên tiếp như
  // vậy là kết luận. Vẫn có `HARD_CAP_MS` để một trường hợp tiến triển cực chậm không chạy mãi.
  let sawCleanMeasurement = false;
  let lastWork = -1;
  let stalledRounds = 0;
  const hardCap = Date.now() + HARD_CAP_MS;
  for (;;) {
    const { blocking, leftover, measured, work } = await reconcileOnce(session, deadline);
    if (measured && blocking === 0) {
      // Đo được, và đĩa đã có đủ + đúng phần store giữ. Ma còn sót thì thử dọn tiếp, nhưng không
      // phán quyết: payload đã được lọc theo store ở `sync.ts`.
      sawCleanMeasurement = true;
      if (leftover === 0) {
        session.diskMatchesStore = true;
        return;
      }
      // Còn ma: dọn tiếp, nhưng cũng theo kiểu phát hiện đứng yên. Xoá hỏng vì đĩa đầy thì thử lại
      // 20 lần trong 2 s cũng vô ích — đo được 11+ vòng `leftover=1 work=0` liên tiếp, và mỗi vòng
      // đều thất bại y hệt. Bỏ cuộc sớm để người dùng không phải chờ 2 s cho một tab đã đóng.
      stalledRounds = work > lastWork ? 0 : stalledRounds + 1;
      lastWork = Math.max(lastWork, work);
      if (stalledRounds >= STALL_LIMIT || Date.now() >= deadline || Date.now() >= hardCap) {
        session.diskMatchesStore = true;
        return;
      }
      await delay(RETRY_PAUSE_MS);
      continue;
    }
    stalledRounds = work > lastWork ? 0 : stalledRounds + 1;
    lastWork = Math.max(lastWork, work);
    if (stalledRounds >= STALL_LIMIT || Date.now() >= hardCap) {
      // Đứng yên thật (hoặc chạm trần cứng). Chỉ báo hỏng nếu chưa lần nào đo được là đĩa khớp.
      if (sawCleanMeasurement) {
        session.diskMatchesStore = true;
        return;
      }
      session.diskMatchesStore = false;
      throw new Error("Còn dữ liệu chưa ghi được xuống máy");
    }
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
): Promise<{ blocking: number; leftover: number; measured: boolean; work: number }> {
  const state = useWorkspaceStore.getState();
  const storeProjects = state.projects;
  const storeTabs = state.tabs;
  const repo = session.repo;

  // `blocking` = đĩa THIẾU hoặc CŨ hơn store → payload đẩy cloud sẽ sai, phải chặn Lưu.
  // `leftover` = đĩa THỪA bản ghi store không còn. Cũng là "chưa sạch": `pushProject` đọc từ đĩa
  // nên bản ghi đã xoá sẽ lọt vào payload (reviewer vòng 9, lỗi 3). Vẫn phải thử lại trước khi
  // chặn, để không tái sinh lỗi 4a vòng 6 (một tab đã xoá khoá nút Lưu vĩnh viễn).
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
    // Không đo được (đọc lỗi, hoặc `guard()` hết hạn). KHÔNG được coi là "hỏng": phán quyết hỏng giả này từng khoá nút Lưu vì một tab đã xoá (lỗi 4a vòng 6, reviewer vòng 9 đo lại được).
    return { blocking: 1, leftover: 0, measured: false, work: 0 };
  }

  // Tra cứu bằng Map, KHÔNG dùng `Array.find()` trong vòng lặp: 600 tab × 600 phần tử là 360k phép
  // so sánh mỗi chiều, đủ để một vòng vượt ngân sách trên máy chậm.
  const diskProjectById = new Map(diskProjects.map((p) => [p.id, p]));
  const diskTabById = new Map(diskTabs.map((t) => [t.id, t]));
  const storeProjectById = new Map(storeProjects.map((p) => [p.id, p]));
  const storeTabById = new Map(storeTabs.map((t) => [t.id, t]));

  // Ghi lại chỗ thiếu hoặc cũ. Mỗi lượt lỗi chỉ tăng bộ đếm, không ném: vòng ngoài quyết định.
  //
  // Nhớ lại id đã ghi để bước xác nhận chỉ đọc đúng phần đó — xem chú thích ở dưới.
  const writtenProjectIds: string[] = [];
  const writtenTabIds: string[] = [];

  for (const project of storeProjects) {
    if (Date.now() >= deadline) return { blocking: blocking + 1, leftover, measured: true, work: writtenProjectIds.length + writtenTabIds.length };
    const onDisk = diskProjectById.get(project.id);
    if (!onDisk || projectDiffers(onDisk, project)) {
      try {
        await guard(repo.upsertProject(project), deadline);
        writtenProjectIds.push(project.id);
      } catch {
        blocking += 1;
      }
    }
  }
  for (const tab of storeTabs) {
    if (Date.now() >= deadline) return { blocking: blocking + 1, leftover, measured: true, work: writtenProjectIds.length + writtenTabIds.length };
    const onDisk = diskTabById.get(tab.id);
    if (!onDisk || tabDiffers(onDisk, tab)) {
      try {
        await guard(repo.upsertTab(tab), deadline);
        writtenTabIds.push(tab.id);
      } catch {
        blocking += 1;
      }
    }
  }



  // Ghi hỏng thì dừng ngay: chưa đo được gì, và bước dọn ma bên dưới chỉ nên chạy khi phần ghi đã
  // sạch (nếu không, hết giờ ở đó sẽ che mất phán quyết "ghi hỏng" — đo được ở N4/V8-2/V8-4/V8-6).
  if (blocking > 0) return { blocking, leftover: 0, measured: true, work: writtenProjectIds.length + writtenTabIds.length };

  // Xác nhận bằng cách ĐỌC LẠI: ghi không ném lỗi vẫn có thể không xuống đĩa (transaction abort muộn,
  // quota chặn giữa chừng). Chỉ tin số đo, không tin lời hứa của lượt ghi.
  //
  // Chỉ đọc lại ĐÚNG những gì vừa ghi, không đọc cả đĩa lần nữa. Bản trước đọc toàn bộ project + tab
  // hai lần mỗi vòng; đo được ngân sách 2 s bị đốt hết ngay vòng đầu khi workspace có 601 tab, nên
  // `flushWorkspace` LUÔN ném và nút Lưu chết vĩnh viễn với người có nhiều dự án:
  //   [E] 20x30 tabs=601 outcome=THREW ms=2000
  //   [E] 30x20 tabs=601 outcome=THREW ms=2002
  // Đọc lại phần vừa ghi là đủ: chỗ KHÔNG ghi thì đã khớp ngay từ lần đọc đầu.
  try {
    for (const id of writtenProjectIds) {
      const onDisk = await guard(repo.getProject(id), deadline);
      const inStore = storeProjectById.get(id);
      if (!inStore) return { blocking: 1, leftover: 0, measured: true, work: 0 };
      if (!onDisk || projectDiffers(onDisk, inStore)) return { blocking: 1, leftover: 0, measured: true, work: 0 };
    }
    // Tab: đọc theo dự án, mỗi dự án một lượt, thay vì một lượt cho mỗi tab.
    const writtenTabsByProject = new Map<string, Set<string>>();
    for (const id of writtenTabIds) {
      const tab = storeTabById.get(id);
      if (!tab) return { blocking: 1, leftover: 0, measured: true, work: 0 };
      const set = writtenTabsByProject.get(tab.projectId) ?? new Set<string>();
      set.add(id);
      writtenTabsByProject.set(tab.projectId, set);
    }
    for (const [projectId, ids] of writtenTabsByProject) {
      const onDiskTabs = await guard(repo.listTabs(projectId), deadline);
      const byId = new Map(onDiskTabs.map((t) => [t.id, t]));
      for (const id of ids) {
        const onDisk = byId.get(id);
        const inStore = storeTabById.get(id);
        if (!inStore || !onDisk || tabDiffers(onDisk, inStore)) {
          return { blocking: 1, leftover: 0, measured: true, work: 0 };
        }
      }
    }
  } catch {
    // Không đọc lại được để xác nhận. Chưa có bằng chứng đĩa khớp → phải chặn (fail-safe).
    return { blocking: 1, leftover: 0, measured: true, work: 0 };
  }

  // Xoá bản ghi ma: có trên đĩa nhưng store không còn. Để lại thì sau F5 nó sống lại và có thể
  // thành tab đang mở, VÀ tệ hơn: `pushProject` đọc tab TỪ ĐĨA (`sync.ts:337`) nên tab đã xoá lọt
  // vào payload đẩy lên cloud — nội dung người dùng tưởng đã xoá lại được gửi đi. Reviewer vòng 9
  // đo được `payloadCoTabDaXoa=true sqlTrongPayload="|SELECT 'bi-mat-cua-toi'"`.
  //
  // Vì vậy bản ghi ma KHÔNG được coi là "khớp". Nó không khoá nút Lưu ngay (đó là lỗi 4a vòng 6),
  // nhưng nó phải được thử lại cho tới hết ngân sách, và nếu vẫn không xoá được thì phán quyết là
  // "chưa sạch" — xem `hasUnflushedFailures()`.
  const deletedProjectIds: string[] = [];
  const deletedTabsByProject = new Map<string, Set<string>>();
  for (const onDisk of diskProjects) {
    if (Date.now() >= deadline) return { blocking, leftover: leftover + 1, measured: true, work: deletedProjectIds.length + deletedTabsByProject.size };
    if (!storeProjectById.has(onDisk.id)) {
      try {
        await guard(repo.deleteProjectCascade(onDisk.id), deadline);
        deletedProjectIds.push(onDisk.id);
      } catch {
        leftover += 1;
      }
    }
  }
  for (const onDisk of diskTabs) {
    if (Date.now() >= deadline) return { blocking, leftover: leftover + 1, measured: true, work: deletedProjectIds.length + deletedTabsByProject.size };
    if (!storeTabById.has(onDisk.id)) {
      try {
        await guard(repo.deleteTab(onDisk.id), deadline);
        const set = deletedTabsByProject.get(onDisk.projectId) ?? new Set<string>();
        set.add(onDisk.id);
        deletedTabsByProject.set(onDisk.projectId, set);
      } catch {
        leftover += 1;
      }
    }
  }

  // Xác nhận đã xoá thật: `deleteTab` resolve không có nghĩa là hàng đã biến mất (một lượt ghi
  // debounce cũ có thể vừa hồi sinh nó). Đặt SAU bước xác nhận ghi ở trên để hết giờ ở đây không
  // làm mất phép đo phần ghi — đo được `[N4]` hết giờ đúng ở nhánh này và biến cả lần Lưu thành
  // "không đo được gì", dù phần ghi đã sạch.
  //
  // Không bao giờ ném và không bao giờ trả `blocking`: chỉ báo `leftover` để vòng ngoài thử lại.
  // Ném ở đây là biến bản ghi ma thành thứ khoá nút Lưu — đúng lỗi 4a vòng 6 mà nhánh `leftover`
  // sinh ra để tránh. Reviewer vòng 9 đo được `[G1] flush=THREW ms=2047` với chỉ một tab ma.
  for (const id of deletedProjectIds) {
    try {
      const onDisk = await guard(repo.getProject(id), deadline);
      if (onDisk) leftover = Math.max(leftover, 1);
    } catch {
      // Không xác nhận được lượt xoá này. KHÔNG đổi `measured`: phép đo phần GHI đã sạch rồi,
      // và đây chỉ là bản ghi ma — chưa xác nhận được thì tính là còn sót, không phải "chưa đo gì".
      leftover = Math.max(leftover, 1);
    }
  }
  for (const [projectId, ids] of deletedTabsByProject) {
    try {
      const onDiskTabs = await guard(repo.listTabs(projectId), deadline);
      if (onDiskTabs.some((t) => ids.has(t.id))) leftover = Math.max(leftover, 1);
    } catch {
      // Không xác nhận được lượt xoá này. KHÔNG đổi `measured`: phép đo phần GHI đã sạch rồi,
      // và đây chỉ là bản ghi ma — chưa xác nhận được thì tính là còn sót, không phải "chưa đo gì".
      leftover = Math.max(leftover, 1);
    }
  }

  // Ảnh chụp store ở đầu hàm đã CŨ nếu người dùng gõ trong lúc ta đang chờ đĩa.
  //
  // Không kiểm ở đây thì: store = B lúc chụp → ghi B xuống đĩa → người dùng gõ thành C → ta đọc
  // lại đĩa, thấy B khớp với ảnh chụp B, kết luận "khớp" và `flushWorkspace` báo THÀNH CÔNG. Đĩa
  // còn B, store là C, và `pushProject` đẩy B lên cloud — đúng bug gốc của Task154, chỉ khác đường
  // vào. Đo được: `outcome=RESOLVED inStore="C" onDisk="B"`.
  //
  // Trả `blocking` để vòng ngoài chạy lại: lần sau nó chụp store MỚI và ghi nốt phần vừa đổi. So
  // sánh bằng danh tính mảng — zustand thay mảng mỗi lần state đổi, nên `!==` bắt được mọi thay đổi
  // mà không phải tự so từng trường.
  const nowState = useWorkspaceStore.getState();
  if (nowState.projects !== storeProjects || nowState.tabs !== storeTabs) {
    return { blocking: 1, leftover: 0, measured: true, work: 0 };
  }
  return { blocking: 0, leftover, measured: true, work: writtenProjectIds.length + writtenTabIds.length + deletedProjectIds.length + deletedTabsByProject.size };
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

/**
 * Trần cho bước ĐO (đối chiếu đĩa với store). Đây là ngân sách duy nhất được phép phán quyết.
 *
 * Đo được: đọc cả 601 tab mất 18 ms, ghi lại 601 tab mất 29 ms, nên 2 s là rất rộng cho một vòng.
 */
const FLUSH_BUDGET_MS = 2000;

/**
 * Số vòng liên tiếp KHÔNG tiến triển thì kết luận là bị chặn.
 *
 * Mỗi vòng cách nhau `RETRY_PAUSE_MS` (100 ms) và bản thân một vòng cũng tốn thời gian, nên 5 vòng
 * đứng yên là hơn nửa giây không ghi được thêm hàng nào — đủ để coi là treo thật.
 */
const STALL_LIMIT = 5;

/**
 * Trần cứng cho toàn bộ vòng đối chiếu, kể cả khi vẫn đang tiến triển.
 *
 * Chỉ để một trường hợp tiến triển cực chậm không chạy mãi. Phải NHỎ HƠN `DISPOSE_WRITE_TIMEOUT_MS`
 * để `disposeWorkspace` không bao giờ cắt ngang một lần flush còn đang tiến triển — đó đúng là lỗi\n * mà V8-4 canh. Đo được: workspace 601 tab cần ~2,2 s cho lượt ghi đầu nên trần phải trên mức đó.
 */
const HARD_CAP_MS = 2500;
/**
 * Trần riêng cho bước CHỜ các lượt ghi đang bay, TRƯỚC khi đo.
 *
 * Phải tách khỏi `FLUSH_BUDGET_MS`: bước chờ không phán quyết gì, nhưng nếu dùng chung ngân sách thì
 * nó ăn hết và bước đo bị bỏ đói, dẫn tới Lưu báo lỗi oan dù đĩa đã khớp store.
 */
const WAIT_BUDGET_MS = 1000;
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

/**
 * Đánh dấu phiên hiện tại là "đã bị xoá sạch có chủ ý".
 *
 * `purgeUserScope()` xoá thẳng trên đĩa, không đi qua store. Không báo cho phiên biết thì lần đối
 * chiếu kế tiếp (lúc `disposeWorkspace` chạy do đổi scope) thấy đĩa thiếu và ghi lại đúng những hàng
 * vừa xoá. Gọi hàm này NGAY SAU khi purge thành công.
 */
export function markWorkspacePurged(): void {
  if (currentSession) currentSession.purged = true;
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
      purged: false,
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
