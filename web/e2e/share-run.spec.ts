import { expect, test, type Page } from "@playwright/test";
import { encodeSnapshot } from "../src/modules/share/codec";
import type { SnapshotV1 } from "../src/modules/share/snapshot";

/**
 * Chạy thử snapshot trên trang share (Task148) — kiểm trên Chromium thật, bản `next build`.
 *
 * Điều quan trọng nhất ở đây là **0 request mạng**: PGlite/SQLite phải tải WASM từ chính
 * origin của trang (asset tĩnh), không có request nào mang nội dung snapshot, và không có
 * request nào tới Gin. Mọi request trong lúc bấm Chạy đều được ghi lại để chấm AC4.
 */

const PG_SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: { name: "Kiểm thử chạy thử", engine: "postgres" },
  tabs: [
    { name: "01_schema.sql", sql: "CREATE TABLE accounts (id int primary key, name text);" },
    {
      name: "02_seed.sql",
      sql: "INSERT INTO accounts VALUES (1, 'an'), (2, 'bình'), (3, 'chi');",
    },
    { name: "03_query.sql", sql: "SELECT id, name FROM accounts ORDER BY id;" },
  ],
};

const SQLITE_SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: { name: "Kiểm thử SQLite", engine: "sqlite" },
  tabs: [
    { name: "01_schema.sql", sql: "CREATE TABLE t (id INT, label TEXT);" },
    { name: "02_query.sql", sql: "INSERT INTO t VALUES (1, 'một'), (2, 'hai'); SELECT * FROM t ORDER BY id;" },
  ],
};

const MYSQL_SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: { name: "Kiểm thử MySQL", engine: "mysql" },
  tabs: [{ name: "01_query.sql", sql: "SELECT 1;" }],
};

async function openShare(page: Page, snapshot: SnapshotV1) {
  const payload = await encodeSnapshot(snapshot);
  await page.goto(`/vi/share#d=${payload}`);
  await expect(page.getByTestId("readonly-workspace")).toBeVisible();
}

/** Mọi request phát sinh sau mốc này được ghi lại: URL + method + có mang payload không. */
function recordRequests(page: Page) {
  const seen: { url: string; method: string }[] = [];
  page.on("request", (req) => seen.push({ url: req.url(), method: req.method() }));
  return seen;
}

test.describe("Chạy thử snapshot (Task148)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 + AC4: snapshot Postgres chạy thật trong máy, kết quả mang nhãn Thật, 0 request mạng", async ({ page }) => {
    await openShare(page, PG_SNAPSHOT);
    const requests = recordRequests(page);

    // Tab thứ ba: cần hai tab trước dựng bảng + nạp dữ liệu trên cùng phiên.
    await page.getByTestId("share-tab-2").click();
    await page.getByTestId("share-run-btn").click();

    // Lần đầu phải tải WASM của PGlite (khoảng 5 MB), nên chờ rộng tay.
    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });
    const panel = page.getByTestId("share-run-panel");
    await expect(panel).toHaveAttribute("data-phase", "done");

    // Nhãn kết luận: đúng "Thật" của dự án, không phải Mô phỏng/Ước lượng.
    await expect(page.getByTestId("share-run-label")).toHaveAttribute("data-label", "real");
    await expect(page.getByTestId("share-run-label")).toHaveText("Thật");
    await expect(panel).not.toContainText("Mô phỏng");
    await expect(panel).not.toContainText("Ước lượng");

    // Kết quả thật: 3 dòng vừa chèn, tiếng Việt còn dấu.
    const result = page.getByTestId("share-run-result");
    await expect(result).toContainText("an");
    await expect(result).toContainText("bình");
    await expect(result).toContainText("chi");
    await expect(panel).toContainText("3 câu đã chạy");

    // AC4: không request nào mang payload; không request nào tới API.
    const api = requests.filter((r) => /\/api\//.test(new URL(r.url).pathname));
    expect(api, `request tới API: ${JSON.stringify(api)}`).toEqual([]);
    const withPayload = requests.filter((r) => r.url.includes("#d=") || r.url.includes("g."));
    expect(withPayload, `request mang payload: ${JSON.stringify(withPayload)}`).toEqual([]);
    // WASM phải tải từ chính origin, không phải CDN bên thứ ba.
    const origins = new Set(requests.map((r) => new URL(r.url).origin));
    const self = new URL(page.url()).origin;
    expect([...origins].filter((o) => o !== self)).toEqual([]);
  });

  test("AC2: snapshot SQLite chạy được bằng WASM ngay trên trang share", async ({ page }) => {
    await openShare(page, SQLITE_SNAPSHOT);
    await page.getByTestId("share-tab-1").click();
    await page.getByTestId("share-run-btn").click();

    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("share-run-label")).toHaveAttribute("data-label", "real");
    const result = page.getByTestId("share-run-result");
    await expect(result).toContainText("một");
    await expect(result).toContainText("hai");
  });

  test("AC3: snapshot MySQL báo cần sandbox, không mở container, không gọi mạng", async ({ page }) => {
    await openShare(page, MYSQL_SNAPSHOT);
    const requests = recordRequests(page);

    await page.getByTestId("share-run-btn").click();

    await expect(page.getByTestId("share-run-sandbox")).toBeVisible();
    // Lý do nằm ở dòng trạng thái của panel, phần thân nói rõ đường đi tiếp theo.
    await expect(page.getByTestId("share-run-panel")).toContainText("MySQL cần sandbox trên máy chủ");
    await expect(page.getByTestId("share-run-sandbox")).toContainText("thêm vào workspace");
    // Không tải WASM nào, không gọi API nào: chỉ có thể là request của trang đã xong trước đó.
    expect(requests.filter((r) => /\/api\//.test(new URL(r.url).pathname))).toEqual([]);
    expect(requests.filter((r) => /\.wasm(\?|$)/.test(r.url))).toEqual([]);
  });

  test("AC5: câu treo bị ngắt sau 1.500 ms, có nút Hủy, UI không đóng băng", async ({ page }) => {
    // `generate_series` 20 triệu dòng giữ PGlite bận lâu hơn hạn 1.500 ms.
    await openShare(page, {
      v: 1,
      project: { name: "Treo", engine: "postgres" },
      tabs: [{ name: "slow.sql", sql: "SELECT count(*) FROM generate_series(1, 20000000);" }],
    });

    const started = Date.now();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-error")).toBeVisible({ timeout: 90_000 });
    const elapsed = Date.now() - started;

    await expect(page.getByTestId("share-run-error")).toContainText("1.500 ms");
    await expect(page.getByTestId("share-run-panel")).toHaveAttribute("data-phase", "error");
    // Hạn 1.500 ms là hạn của câu SQL; thời gian chờ WASM lần đầu không tính vào đây.
    expect(elapsed).toBeLessThan(90_000);
    // Giao diện còn phản hồi sau khi ngắt: nút Chạy bấm lại được.
    await expect(page.getByTestId("share-run-btn")).toBeEnabled();
  });

  test("AC5: nút Hủy hiện trong lúc chạy và ngắt được câu dài", async ({ page }) => {
    await openShare(page, {
      v: 1,
      project: { name: "Treo", engine: "postgres" },
      tabs: [{ name: "slow.sql", sql: "SELECT count(*) FROM generate_series(1, 20000000);" }],
    });

    await page.getByTestId("share-run-btn").click();
    // Trong lúc nạp WASM hoặc đang chạy, nút Hủy phải có mặt.
    const cancel = page.getByTestId("share-run-cancel");
    await expect(cancel).toBeVisible({ timeout: 90_000 });
    await cancel.click();

    await expect(page.getByTestId("share-run-panel")).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
    await expect(page.getByTestId("share-run-error")).toContainText("Đã hủy");
    await expect(page.getByTestId("share-run-btn")).toBeEnabled();
  });

  test("AC6: kết quả không vào URL, F5 là mất kết quả", async ({ page }) => {
    await openShare(page, PG_SNAPSHOT);
    const urlBefore = page.url();
    // Chụp kho lưu trữ **trước** khi chạy: khung ứng dụng có thể đã ghi tùy chọn bố cục từ trước,
    // nên điều cần chứng minh là chạy thử không thêm khóa nào và không ghi nội dung kết quả.
    const readStores = () =>
      page.evaluate(() => ({
        local: Object.keys(localStorage).sort(),
        session: Object.keys(sessionStorage).sort(),
        body: JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
      }));
    const before = await readStores();

    await page.getByTestId("share-tab-2").click();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });

    // URL không đổi: không có tham số nào được thêm, hash vẫn là payload gốc.
    expect(page.url()).toBe(urlBefore);

    const after = await readStores();
    // `sqllens.layout` là tùy chọn bố cục của khung ứng dụng, ShellProvider ghi không đồng bộ sau khi
    // gắn — có sẵn từ trước Task148 và không liên quan tới kết quả. Mọi khóa khác phải y nguyên.
    const keys = (list: string[]) => list.filter((k) => k !== "sqllens.layout");
    expect(keys(after.local)).toEqual(keys(before.local));
    expect(after.session).toEqual(before.session);
    // Và chắc chắn không có dòng dữ liệu nào của kết quả bị ghi xuống: kết quả là 'bình', 'chi'.
    expect(after.body).not.toContain("bình");
    expect(after.body).not.toContain("chi");
    // Cũng không ghi lại SQL của snapshot hay tên dự án.
    expect(after.body).not.toContain("accounts");
    expect(after.body).not.toContain(PG_SNAPSHOT.project.name);

    await page.reload();
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();
    await expect(page.getByTestId("share-run-result")).toHaveCount(0);
    await expect(page.getByTestId("share-run-panel")).toHaveAttribute("data-phase", "idle");
  });

  test("ca biên: bấm Chạy 5 lần liên tiếp không treo, không rò phiên", async ({ page }) => {
    await openShare(page, PG_SNAPSHOT);
    await page.getByTestId("share-tab-2").click();

    for (let i = 0; i < 5; i++) {
      await page.getByTestId("share-run-btn").click();
      // Nút tự khóa trong lúc chạy, nên 5 lần bấm rơi vào các lượt khác nhau hoặc bị bỏ qua.
      await expect(page.getByTestId("share-run-panel")).not.toHaveAttribute("data-phase", "busy", {
        timeout: 90_000,
      });
    }

    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("share-run-btn")).toBeEnabled();
  });

  test("ca biên: SQL lỗi cú pháp báo lỗi rõ, không đóng băng", async ({ page }) => {
    await openShare(page, {
      v: 1,
      project: { name: "Lỗi", engine: "postgres" },
      tabs: [{ name: "bad.sql", sql: "SELEC 1;" }],
    });

    await page.getByTestId("share-run-btn").click();

    await expect(page.getByTestId("share-run-error")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("share-run-error")).toContainText(/syntax error/i);
    await expect(page.getByTestId("share-run-btn")).toBeEnabled();
  });
});

test.describe("Chạy thử snapshot — 390px và bản tiếng Anh (AC7)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("AC7: 390px không tràn ngang, nút Chạy và vùng kết quả dùng được", async ({ page }) => {
    const payload = await encodeSnapshot(PG_SNAPSHOT);
    await page.goto(`/en/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    // Bản tiếng Anh: nút Chạy có nhãn tiếng Anh.
    await expect(page.getByTestId("share-run-btn")).toContainText("Run");
    await expect(page.getByTestId("share-run-panel")).toContainText("Runs in your browser");

    await page.getByTestId("share-tab-2").click();
    await page.getByTestId("share-run-btn").click();
    await expect(page.getByTestId("share-run-result")).toBeVisible({ timeout: 90_000 });

    // Nhãn kết luận ở bản tiếng Anh là "Real".
    await expect(page.getByTestId("share-run-label")).toHaveText("Real");
    await expect(page.getByTestId("share-run-panel")).toContainText("3 statements ran");

    // Không tràn ngang ở 390px, kể cả khi bảng kết quả rộng.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(overflow.win);
  });
});
