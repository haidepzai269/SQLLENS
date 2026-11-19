import { expect, test } from "@playwright/test";
import { gotoHydrated, parsePdf } from "./helpers";

test.beforeEach(({ page }) =>
  page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" }))
);

const T = {
  vi: {
    url: "/vi/print/audit",
    title: "Báo cáo kiểm toán cơ sở dữ liệu",
    healthScore: "Điểm sức khỏe cơ sở dữ liệu",
    findings: "Chi tiết rủi ro & bằng chứng",
    plan: "Kế hoạch thực thi truy vấn",
    disclaimer:
      "Báo cáo này được tạo tự động từ kết quả chạy trong môi trường Sandbox của SQLLens. Mọi kết luận chỉ có giá trị trong phạm vi dữ liệu và kịch bản thử nghiệm.",
    emptyTitle: "Chưa có kết luận",
    branding: "SQLLens Database Audit Report",
  },
  en: {
    url: "/en/print/audit",
    title: "Database Audit Report",
    healthScore: "Database Health Score",
    findings: "Findings & Evidence",
    plan: "Query Execution Plan",
    disclaimer:
      "This report was generated automatically from SQLLens Sandbox. All conclusions are valid only within the tested data and scenarios.",
    emptyTitle: "No conclusions available",
    branding: "SQLLens Database Audit Report",
  },
} as const;

test.describe("Task142: In PDF bằng Playwright và kiểm nội dung", () => {
  test("AC1, AC3, AC4, AC5 & Ca biên rỗng: In PDF báo cáo rỗng trên /vi/print/audit", async ({ page }) => {
    await gotoHydrated(page, T.vi.url);

    // Chờ 3 trang báo cáo và trạng thái rỗng hiển thị
    await expect(page.locator('[data-testid="report-page-1"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-2"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-3"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="findings-empty"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="plan-empty"]').first()).toBeVisible();

    // Sinh PDF thật qua Chromium Playwright (ưu tiên cỡ trang CSS A4)
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // Phân tích nội dung file PDF bằng parser thuần Node.js
    const parsed = parsePdf(pdfBuffer);

    // AC1: Đếm đúng 3 trang
    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);

    // AC3: Disclaimer sandbox có mặt ở cả 3 trang
    for (const p of parsed.pages) {
      expect(p.text).toContain(T.vi.disclaimer);
    }

    // AC4: Tiếng Việt không mất dấu, so chuỗi có dấu cụ thể
    expect(parsed.pages[0].text).toContain(T.vi.title);
    expect(parsed.pages[0].text).toContain(T.vi.healthScore);
    expect(parsed.pages[1].text).toContain(T.vi.findings);
    expect(parsed.pages[1].text).toContain(T.vi.emptyTitle);
    expect(parsed.pages[2].text).toContain(T.vi.plan);
    expect(parsed.pages[2].text).toContain(T.vi.emptyTitle);

    // Ca biên 3: Không trộn tiếng Anh vào bản in tiếng Việt
    expect(parsed.fullText).not.toContain("This report was generated automatically");
    expect(parsed.fullText).not.toContain("No conclusions available");
  });

  test("AC1, AC3, AC5 & Ca biên rỗng: In PDF báo cáo rỗng trên /en/print/audit", async ({ page }) => {
    await gotoHydrated(page, T.en.url);

    await expect(page.locator('[data-testid="report-page-1"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-2"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-3"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="findings-empty"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="plan-empty"]').first()).toBeVisible();

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const parsed = parsePdf(pdfBuffer);

    // AC1: Đếm đúng 3 trang
    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);

    // AC3: Disclaimer sandbox có mặt ở cả 3 trang
    for (const p of parsed.pages) {
      expect(p.text).toContain(T.en.disclaimer);
    }

    // AC5: Kiểm tra nội dung tiếng Anh chuẩn
    expect(parsed.pages[0].text).toContain(T.en.title);
    expect(parsed.pages[0].text).toContain(T.en.healthScore);
    expect(parsed.pages[1].text).toContain(T.en.findings);
    expect(parsed.pages[1].text).toContain(T.en.emptyTitle);
    expect(parsed.pages[2].text).toContain(T.en.plan);
    expect(parsed.pages[2].text).toContain(T.en.emptyTitle);

    // Ca biên 3: Không trộn tiếng Việt vào bản in tiếng Anh
    expect(parsed.fullText).not.toContain("Báo cáo này được tạo tự động");
    expect(parsed.fullText).not.toContain("Chưa có kết luận");
  });

  test("AC1, AC2, AC3, AC4, AC5: In PDF báo cáo có dữ liệu (Findings & Nhãn kết luận) trên /vi/print/audit", async ({ page }) => {
    // 1. Vào trang Lab chính để nhập schema và câu lệnh mẫu
    await gotoHydrated(page, "/vi");

    const sqlEditor = page.locator(".cm-content").first();
    await sqlEditor.waitFor({ state: "visible" });

    const sampleSql = [
      "CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(255));",
      "CREATE TABLE orders (id INT, total FLOAT, customer_id INT);",
      "SELECT * FROM orders;",
    ].join("\n");

    // Điền SQL vào editor
    await sqlEditor.fill(sampleSql);

    // Chờ 500ms để autosave debounce (300ms) lưu vào IndexedDB
    await page.waitForTimeout(600);

    // 2. Chuyển sang trang in báo cáo kiểm toán /vi/print/audit
    await gotoHydrated(page, T.vi.url);

    // Chờ trang render xong findings và điểm sức khỏe
    await expect(page.locator('[data-testid="report-page-1"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-2"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-3"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="health-score-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="finding-row"]').first()).toBeVisible();

    // 3. Sinh PDF bằng Chromium Playwright
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const parsed = parsePdf(pdfBuffer);

    // AC1: Đếm đúng 3 trang
    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);

    // AC2: Kiểm tra các nhãn kết luận xuất hiện trong nội dung PDF
    // - Nhãn "Ước lượng" ở điểm sức khỏe
    // - Nhãn "Chưa xác nhận" (unverified) ở tóm tắt và danh sách findings
    // - Nhãn "Không hỏng ở kịch bản này" (not_broken)
    expect(parsed.pages[0].text).toContain("Ước lượng");
    expect(parsed.pages[0].text).toContain("Chưa xác nhận");
    expect(parsed.pages[0].text).toContain("Không hỏng ở kịch bản này");

    // Trang 2: Chi tiết findings chứa tên bảng và luật vi phạm
    expect(parsed.pages[1].text).toContain(T.vi.findings);
    expect(parsed.pages[1].text).toContain("orders");
    expect(parsed.pages[1].text).toContain("Chưa xác nhận");
    expect(parsed.pages[1].text).toContain("Ước lượng");

    // Trang 3: Kế hoạch thực thi chứa câu truy vấn SELECT
    expect(parsed.pages[2].text).toContain(T.vi.plan);
    expect(parsed.pages[2].text).toContain("SELECT * FROM orders");

    // AC3: Disclaimer sandbox có mặt ở cả 3 trang
    for (const p of parsed.pages) {
      expect(p.text).toContain(T.vi.disclaimer);
    }

    // AC4: Tiếng Việt có dấu không mất dấu
    expect(parsed.pages[0].text).toContain(T.vi.title);
    expect(parsed.pages[0].text).toContain(T.vi.healthScore);
    expect(parsed.pages[1].text).toContain("Chi tiết rủi ro & bằng chứng");
  });

  test("AC1, AC2, AC3, AC5: In PDF báo cáo có dữ liệu trên /en/print/audit", async ({ page }) => {
    await gotoHydrated(page, "/en");

    const sqlEditor = page.locator(".cm-content").first();
    await sqlEditor.waitFor({ state: "visible" });

    const sampleSql = [
      "CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(255));",
      "CREATE TABLE orders (id INT, total FLOAT, customer_id INT);",
      "SELECT * FROM orders;",
    ].join("\n");

    await sqlEditor.fill(sampleSql);
    await page.waitForTimeout(600);

    await gotoHydrated(page, T.en.url);

    await expect(page.locator('[data-testid="report-page-1"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-2"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="report-page-3"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="health-score-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="finding-row"]').first()).toBeVisible();

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const parsed = parsePdf(pdfBuffer);

    // AC1: Đếm đúng 3 trang
    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);

    // AC2: Kiểm tra các nhãn tiếng Anh xuất hiện trong PDF
    expect(parsed.pages[0].text).toContain("Estimated");
    expect(parsed.pages[0].text).toContain("Unverified");
    expect(parsed.pages[0].text).toContain("Not broken in this scenario");

    // Trang 2
    expect(parsed.pages[1].text).toContain(T.en.findings);
    expect(parsed.pages[1].text).toContain("orders");
    expect(parsed.pages[1].text).toContain("Not confirmed");
    expect(parsed.pages[1].text).toContain("Estimated");

    // Trang 3
    expect(parsed.pages[2].text).toContain(T.en.plan);
    expect(parsed.pages[2].text).toContain("SELECT * FROM orders");

    // AC3: Disclaimer sandbox có mặt ở cả 3 trang
    for (const p of parsed.pages) {
      expect(p.text).toContain(T.en.disclaimer);
    }
  });

  test("Ca biên 30 findings & AC6: Báo cáo thu gọn findings không tràn trang, PDF đúng 3 trang", async ({ page }) => {
    await gotoHydrated(page, "/vi");

    const sqlEditor = page.locator(".cm-content").first();
    await sqlEditor.waitFor({ state: "visible" });

    // Tạo 30 bảng với kiểu FLOAT lưu tiền và không có Primary Key -> sinh ra 30 findings
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const pad = String(i).padStart(2, "0");
      lines.push(`CREATE TABLE t_${pad} (amount_${pad} FLOAT);`);
    }
    lines.push("SELECT * FROM t_01;");

    await sqlEditor.fill(lines.join("\n"));
    await page.waitForTimeout(600);

    await gotoHydrated(page, T.vi.url);

    // Chờ thông báo thu gọn findings hiển thị (hơn 10 findings)
    await expect(page.locator('[data-testid="findings-more-notice"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="finding-row"]')).toHaveCount(10);

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const parsed = parsePdf(pdfBuffer);

    // AC1: Dù có 30 findings, báo cáo vẫn không bị tràn, đếm đúng 3 trang A4
    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages).toHaveLength(3);

    // Trang 2 chứa dòng thông báo thu gọn
    expect(parsed.pages[1].text).toContain("Đang hiển thị 10/30 rủi ro nghiêm trọng nhất");

    // AC3: Disclaimer vẫn có ở cả 3 trang
    for (const p of parsed.pages) {
      expect(p.text).toContain(T.vi.disclaimer);
    }
  });
});
