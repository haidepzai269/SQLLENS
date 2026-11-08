import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, throttleCpu } from "./helpers";

type L = "vi" | "en";

const T = {
  vi: {
    aboutTitle: /SQLLens.*database hỏng/,
    aboutHeading: "Thấy database hỏng",
    openCta: /Mở SQLLens|Vào phòng Lab/i,
    loadSample: /Nạp mẫu SQL|Nạp câu mẫu|Mẫu SQL/i,
    real: "Thật",
    sim: "Mô phỏng",
    schemaTab: "Sơ đồ",
    planTab: "Plan",
    btreeTab: "B-Tree",
    whatifTab: "Thử sửa",
    conflictTab: "Tranh chấp",
    stageTab: "Mô phỏng",
    risksTab: "Rủi ro",
    sqlTab: "SQL",
    terminalTab: "Terminal",
    stepForward: "Bước tới",
  },
  en: {
    aboutTitle: /SQLLens.*database breaks/,
    aboutHeading: "See where it breaks",
    openCta: /Open SQLLens|Enter Lab/i,
    loadSample: /Try sample SQL|Load sample|Sample SQL/i,
    real: "Real",
    sim: "Simulated",
    schemaTab: "Schema",
    planTab: "Plan",
    btreeTab: "B-Tree",
    whatifTab: "Try a fix",
    conflictTab: "Conflicts",
    stageTab: "Simulation",
    risksTab: "Risks",
    sqlTab: "SQL",
    terminalTab: "Terminal",
    stepForward: "Step forward",
  },
} as const;

// Nguyên tắc 2: Không bao giờ nói "thiết kế này ổn" hoặc các biến thể tương đương.
const BAD_PHRASE = /thiết kế (của bạn |này )?(đã )?ổn|design is (fine|ok|good)|good design/i;

// Nguyên tắc 1: Mọi nhãn kết luận phải mang đúng 1 trong các nhãn chuẩn.
const VALID_LABELS = {
  vi: ["Thật", "Mô phỏng", "Ước lượng", "Chưa mô phỏng được", "Không đặt tiêu chí"],
  en: ["Real", "Simulated", "Estimated", "Not simulated yet", "Cannot be simulated yet", "No criteria set"],
} as const;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message, err.stack));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
  });
  await throttleCpu(page);
  // Mock /api/me 503 để modal đăng nhập không che màn hình
  await page.route("**/api/me", (route) => route.fulfill({ status: 503, body: "{}" }));
});

const noHScroll = async (p: Page) => {
  const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await p.evaluate(() => window.innerWidth);
  return scrollWidth <= innerWidth;
};

// Đảm bảo tab Mô phỏng (Stage) đang mở trên Mobile (Desktop luôn hiển thị)
async function ensureStageOpen(p: Page, l: L) {
  const stageTab = p.getByRole("tab", { name: T[l].stageTab, exact: true });
  if (await stageTab.isVisible()) {
    await stageTab.click();
  }
  await expect(p.locator("#stage")).toBeVisible();
}

// Đảm bảo tab SQL đang mở trên Mobile (Desktop luôn hiển thị)
async function ensureSqlOpen(p: Page, l: L) {
  const sqlTab = p.getByRole("tab", { name: T[l].sqlTab, exact: true });
  if (await sqlTab.isVisible()) {
    await sqlTab.click();
  }
  await expect(p.locator(".cm-content:visible").first()).toBeVisible();
}

// Chạy trọn vẹn Golden Path 10 bước trên cả 2 ngôn ngữ và 2 độ phân giải màn hình chuẩn
for (const l of ["vi", "en"] as const) {
  const t = T[l];
  for (const [name, w, h] of [
    ["1440 Desktop", 1440, 900],
    ["390 Mobile", 390, 844],
  ] as const) {
    test.describe(`Golden Path [${l.toUpperCase()} - ${name}]`, () => {
      test.use({ viewport: { width: w, height: h } });

      test("10 bước Luồng vàng từ /about -> Lab -> Schema, Plan, B-Tree, Findings, What-if, Conflict", async ({
        page,
      }) => {
        test.setTimeout(180_000); // Đủ thời gian cho PGlite khởi tạo và chạy các tab

        // =========================================================================
        // BƯỚC 1: Truy cập /about, kiểm tra GSAP intro, bấm CTA vào phòng Lab
        // =========================================================================
        await gotoHydrated(page, `/${l}/about`);
        await expect(page).toHaveTitle(t.aboutTitle);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(t.aboutHeading);
        expect(await noHScroll(page)).toBe(true);

        // Bấm CTA dẫn vào phòng Lab
        const ctaBtn = page.getByRole("link", { name: t.openCta }).first();
        await expect(ctaBtn).toBeVisible();
        await ctaBtn.click();
        await expect(page).toHaveURL(new RegExp(`/${l}$`));
        await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 2: Bấm nút nạp mẫu SQL, nội dung xuất hiện chuẩn trong CodeMirror
        // =========================================================================
        const loadSampleBtn = page
          .getByTestId("stage-empty-load-sample")
          .or(page.getByRole("button", { name: t.loadSample }))
          .first();
        await expect(loadSampleBtn).toBeVisible({ timeout: 15_000 });
        await loadSampleBtn.click();

        // Chuyển sang ô SQL để xác nhận nội dung mẫu đã nạp
        await ensureSqlOpen(page, l);
        const editorContent = page.locator(".cm-content:visible").first();
        await expect(editorContent).toContainText("CREATE TABLE users", { timeout: 10_000 });
        await expect(editorContent).toContainText("CREATE TABLE orders");
        await expect(editorContent).toContainText("REFERENCES users");

        // =========================================================================
        // BƯỚC 3: Nhấn Ctrl+Enter (Meta+Enter) -> PGlite chạy -> Result Grid & badge Thật
        // =========================================================================
        await editorContent.focus();
        await page.keyboard.press("ControlOrMeta+Enter");

        // Result Grid có các dòng trả về (trên mobile tự động chuyển sang tab Terminal)
        const gridRows = page.locator("tbody:visible tr");
        await expect(gridRows).toHaveCount(3, { timeout: 60_000 });
        expect(await noHScroll(page)).toBe(true);

        // Chờ kết quả hiển thị với nhãn Thật (Real)
        // Trên mobile, vùng Kết luận / Rủi ro nằm trong tab Rủi ro (Findings)
        const risksTrigger = page.getByRole("tab", { name: t.risksTab, exact: true });
        if (await risksTrigger.isVisible()) {
          await risksTrigger.click();
        }
        const conclusion = page.locator('[data-testid="conclusion"]:visible');
        await expect(conclusion).toBeVisible({ timeout: 15_000 });
        await expect(conclusion).toContainText(t.real);
        expect(await conclusion.innerText()).not.toMatch(BAD_PHRASE);

        // =========================================================================
        // BƯỚC 4: Mở tab Schema -> kiểm tra các node bảng, quan hệ FK, pan Space
        // =========================================================================
        await ensureStageOpen(page, l);
        const stageArea = page.locator("#stage");
        const schemaTrigger = stageArea.getByRole("tab", { name: t.schemaTab, exact: true });
        await schemaTrigger.click();

        // Kiểm tra node bảng users và orders
        const usersNode = stageArea.locator(".react-flow__node").filter({ hasText: "users" });
        const ordersNode = stageArea.locator(".react-flow__node").filter({ hasText: "orders" });
        await expect(usersNode).toBeVisible({ timeout: 30_000 });
        await expect(ordersNode).toBeVisible();

        // Thẻ orders có đánh dấu Foreign Key (FK) và đường nối edge
        await expect(ordersNode.getByText("FK")).toHaveCount(1);
        await expect(stageArea.locator(".react-flow__edge")).toHaveCount(1);

        // Thao tác pan canvas bằng phím Space
        const canvas = page.getByTestId("schema-canvas");
        await expect(canvas).toBeVisible();
        await page.keyboard.down("Space");
        await expect(canvas).toHaveClass(/space-panning/);
        await page.keyboard.up("Space");
        await expect(canvas).not.toHaveClass(/space-panning/);
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 5: Mở tab Plan -> Cây kế hoạch nhãn Thật & Join animation
        // =========================================================================
        const planTrigger = stageArea.getByRole("tab", { name: t.planTab, exact: true });
        await planTrigger.click();

        await expect(stageArea.getByTestId("plan-tree")).toBeVisible({ timeout: 30_000 });
        const planLabel = stageArea.getByTestId("plan-label");
        await expect(planLabel).toHaveAttribute("data-label", "real");
        await expect(planLabel).toContainText(t.real);

        // Kiểm tra khối hoạt ảnh Join (Join animation)
        await expect(stageArea.getByTestId("stage-joins")).toBeVisible({ timeout: 15_000 });
        const joinAnim = stageArea.getByTestId("join-anim").first();
        await expect(joinAnim).toBeVisible();
        await expect(stageArea.getByTestId("join-sample").first()).toBeVisible();
        await expect(joinAnim).toHaveAttribute("data-step", "0");
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 6: Mở tab B-Tree -> B-Tree Reader (rơi key, Range Scan, BTreeRace)
        // =========================================================================
        const btreeTrigger = stageArea.getByRole("tab", { name: t.btreeTab, exact: true });
        await btreeTrigger.click();

        // Chọn index
        const indexSelect = stageArea.locator("#stage-index");
        await expect(indexSelect).toBeVisible({ timeout: 20_000 });
        await indexSelect.selectOption("idx_users_email");

        // Rơi key đơn
        await stageArea.locator("#stage-key").fill("user_1@example.com");
        await stageArea.getByTestId("stage-drop").click();
        await expect(stageArea.getByTestId("btree-drop")).toBeVisible({ timeout: 30_000 });

        // Chuyển đổi Range Scan
        await stageArea.locator("#stage-key-to").fill("user_5@example.com");
        await stageArea.getByTestId("stage-drop").click();
        await expect(stageArea.getByTestId("btree-drop")).toBeVisible({ timeout: 30_000 });

        // Thanh cuộc đua BTreeRace số trang/dòng (nhãn Thật, không có ms)
        const race = stageArea.getByTestId("btree-race");
        await expect(race).toBeVisible({ timeout: 15_000 });
        const raceLabel = stageArea.getByTestId("race-label");
        await expect(raceLabel).toHaveAttribute("data-label", "real");
        await expect(raceLabel).toContainText(t.real);
        await expect(stageArea.getByTestId("race-seq-pages")).toBeVisible();
        await expect(stageArea.getByTestId("race-note")).toBeVisible();

        const raceText = await race.innerText();
        expect(raceText).not.toMatch(/\b\d+(\.\d+)?\s*(ms|µs|us|s|giây|second)\b/i);
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 7: Tab Findings -> danh sách rủi ro, bấm rủi ro tô sáng SQL & focus node
        // =========================================================================
        // Mở panel Rủi ro nếu đang trên Mobile
        const risksTab = page.getByRole("tab", { name: t.risksTab, exact: true });
        if (await risksTab.isVisible()) {
          await risksTab.click();
        }

        const findingsPanel = page.getByTestId("findings");
        await expect(findingsPanel).toBeVisible({ timeout: 60_000 });
        const riskItems = page.locator("[data-testid=finding]");
        await expect(riskItems.first()).toBeVisible({ timeout: 60_000 });

        // Bấm vào rủi ro đầu tiên
        const firstRisk = riskItems.first();
        await expect(firstRisk.getByTestId("finding-label")).toBeVisible();
        await firstRisk.locator("button[aria-pressed]").first().click();

        // Kiểm tra CodeMirror được tô sáng (.cm-sql-hit)
        await ensureSqlOpen(page, l);
        await expect(page.locator(".cm-sql-hit:visible")).toBeVisible({ timeout: 15_000 });

        // Kiểm tra sơ đồ hiển thị node bảng tương ứng
        await ensureStageOpen(page, l);
        await expect(stageArea.locator(".react-flow__node").filter({ hasText: /users|orders/ }).first()).toBeVisible({ timeout: 15_000 });
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 8: Mở tab What-if -> áp dụng sửa trong transaction, kiểm tra bảng so sánh
        // =========================================================================
        const whatifTrigger = stageArea.getByRole("tab", { name: t.whatifTab, exact: true });
        await whatifTrigger.click();

        const whatifEditor = stageArea.getByTestId("whatif-editor");
        await expect(whatifEditor).toBeVisible({ timeout: 30_000 });

        // Nhập cách sửa tạo index biểu thức qua bàn phím để CodeMirror kích hoạt state change
        const whatifCm = whatifEditor.locator(".cm-content");
        await whatifCm.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("CREATE INDEX idx_users_lower_email ON users (lower(email));");
        await stageArea.getByTestId("whatif-run").click();

        // Bảng so sánh trước và sau (số trang, số dòng)
        await expect(stageArea.getByTestId("whatif-result")).toBeVisible({ timeout: 60_000 });
        await expect(stageArea.getByTestId("whatif-pages").first()).toBeVisible();
        await expect(stageArea.getByTestId("whatif-rows").first()).toBeVisible();
        await expect(stageArea.getByTestId("whatif-column")).toHaveCount(2);

        // Cột plan mang nhãn Thật (Real)
        const whatifPlanLabel = stageArea.getByTestId("plan-label").first();
        await expect(whatifPlanLabel).toContainText(t.real);
        expect(await noHScroll(page)).toBe(true);

        // =========================================================================
        // BƯỚC 9: Mở tab Conflict -> chọn kịch bản Deadlock, chạy timeline, kiểm tra Cytoscape
        // =========================================================================
        const conflictTrigger = stageArea.getByRole("tab", { name: t.conflictTab, exact: true });
        await conflictTrigger.click();

        const conflictPanel = page.getByTestId("conflict-panel");
        await expect(conflictPanel).toBeVisible({ timeout: 30_000 });

        // Chọn kịch bản Deadlock do cập nhật ngược thứ tự
        const scenarioSelect = page.locator("#cf-scenario");
        await scenarioSelect.selectOption("deadlock_reverse_order");

        // Nhãn Mô phỏng (Simulated)
        const cfLabel = page.getByTestId("cf-label");
        await expect(cfLabel).toHaveText(t.sim);

        // Chạy các nhịp timeline bằng nút Bước tới, ghi nhận vòng chờ deadlock
        const stepBtn = page.getByRole("button", { name: t.stepForward, exact: true });
        let sawCycle = false;
        while (await stepBtn.isEnabled()) {
          await stepBtn.click();
          const cycle = await page.getByTestId("wait-graph").getAttribute("data-cycle");
          if (cycle === "true") sawCycle = true;
        }
        expect(sawCycle).toBe(true);

        // Tiêu chí hỏng mang nhãn deadlock
        const cfOutcome = page.getByTestId("cf-outcome");
        await expect(cfOutcome).toHaveAttribute("data-outcome", "deadlock");
        await expect(cfOutcome).toBeVisible();

        // =========================================================================
        // BƯỚC 10: Xác nhận quy chuẩn toàn diện (Nguyên tắc 1 & 2, Không cuộn ngang)
        // =========================================================================
        // Không cuộn ngang
        expect(await noHScroll(page)).toBe(true);

        // Toàn bộ nội dung trang không chứa bất kỳ từ ngữ nào hàm ý "thiết kế này ổn"
        const fullBodyText = await page.locator("body").innerText();
        expect(fullBodyText).not.toMatch(BAD_PHRASE);

        // Mọi nhãn kết luận trên màn hình phải thuộc danh mục hợp lệ
        const labelsFound = await page
          .locator('[data-testid$="-label"], [data-testid="conclusion"]')
          .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).filter(Boolean));

        const expectedValid = VALID_LABELS[l];
        for (const lbl of labelsFound) {
          const hasValidLabel = expectedValid.some((valid) => lbl.includes(valid));
          expect(hasValidLabel, `Nhãn kết luận "${lbl}" không thuộc danh mục hợp lệ`).toBe(true);
        }
      });
    });
  }
}
