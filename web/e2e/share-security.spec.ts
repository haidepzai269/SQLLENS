import { expect, test, type Page } from "@playwright/test";
import { encodeSnapshot } from "../src/modules/share/codec";
import type { SnapshotV1 } from "../src/modules/share/snapshot";

/**
 * Kiểm thử bảo mật trang chia sẻ snapshot (Task156):
 * - AC1 & AC2: Chống XSS trong SQL, tab name, project name (không alert, không inject HTML).
 * - AC3: Header Referrer-Policy: no-referrer trên cả /vi/share và /en/share.
 * - AC4: Không rò rỉ fragment/payload trong Referer khi ra domain ngoài.
 * - Ca biên: payload có javascript:, </textarea>, mở trong iframe, bấm Fork.
 */

const XSS_SQL_SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: { name: "Kiểm tra XSS SQL", engine: "postgres" },
  tabs: [
    {
      name: "01_xss.sql",
      sql: `<img src=x onerror=alert('xss-sql-img')><script>alert('xss-sql-script')</script>\nSELECT '"><script>alert(1)</script>' AS test;`,
    },
    {
      name: "02_proto.sql",
      sql: `SELECT 'javascript:alert(2)';`,
    },
  ],
};

const XSS_NAMES_SNAPSHOT: SnapshotV1 = {
  v: 1,
  project: {
    name: `<b id="evil-proj-node" onmouseover="alert('xss-proj')">Dự án độc</b>"><script>alert('xss-proj-script')</script>`,
    engine: "sqlite",
  },
  tabs: [
    {
      name: `javascript:alert('xss-tab-proto')`,
      sql: `SELECT 1;`,
    },
    {
      name: `"><script>alert('xss-tab-tag')</script></textarea>`,
      sql: `SELECT 2;</textarea><script>alert('xss-textarea')</script>`,
    },
  ],
};

function setupDialogSpy(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => {});
  });
  return dialogs;
}

test.describe("Bảo mật Share Snapshot (Task156)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 + AC2: Payload độc hại trong SQL không thực thi script, không inject HTML, hiển thị text an toàn", async ({
    page,
  }) => {
    const dialogs = setupDialogSpy(page);
    const payload = await encodeSnapshot(XSS_SQL_SNAPSHOT);

    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    // AC2: Tuyệt đối không có bất kỳ alert hay dialog nào được kích hoạt
    expect(dialogs, `Phát hiện dialog bật lên: ${dialogs.join(", ")}`).toEqual([]);

    // AC1: Không có thẻ img lỗi nào được render vào DOM
    const evilImages = page.locator('img[src="x"]');
    expect(await evilImages.count()).toBe(0);

    // Không có script inject nào trong DOM
    const injectedScripts = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      return scripts.filter((s) => s.textContent?.includes("xss-sql-script")).length;
    });
    expect(injectedScripts).toBe(0);

    // Nội dung SQL vẫn đọc được bình thường trong editor dưới dạng raw text (không bị mất ký tự)
    const editor = page.locator(".cm-content");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("<img src=x onerror=alert('xss-sql-img')>");
    await expect(editor).toContainText("<script>alert('xss-sql-script')</script>");

    expect(dialogs).toEqual([]);
  });

  test("Ca biên: Tên tab và tên dự án chứa javascript:, </textarea>, thẻ HTML và script tag", async ({
    page,
  }) => {
    const dialogs = setupDialogSpy(page);
    const payload = await encodeSnapshot(XSS_NAMES_SNAPSHOT);

    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    // Không có dialog nào
    expect(dialogs).toEqual([]);

    // Tên dự án: không được tạo node HTML <b> thật trong DOM
    const evilNode = page.locator("#evil-proj-node");
    expect(await evilNode.count()).toBe(0);

    // Header hiển thị text nguyên vẹn (escape an toàn)
    const projHeading = page.getByTestId("share-project-name");
    await expect(projHeading).toBeVisible();
    await expect(projHeading).toHaveText(
      `<b id="evil-proj-node" onmouseover="alert('xss-proj')">Dự án độc</b>"><script>alert('xss-proj-script')</script>`,
    );

    // Tab 0 chứa `javascript:alert(...)`: hiển thị dưới dạng chuỗi, không thực thi protocol
    const tab0 = page.getByTestId("share-tab-0");
    await expect(tab0).toBeVisible();
    await expect(tab0).toContainText(`javascript:alert('xss-tab-proto')`);

    // Tab 1 chứa `</textarea>` và `<script>`:
    const tab1 = page.getByTestId("share-tab-1");
    await expect(tab1).toBeVisible();
    await expect(tab1).toContainText(`"><script>alert('xss-tab-tag')</script></textarea>`);

    // Bấm chuyển tab 1: editor hiển thị an toàn
    await tab1.click();
    const editor = page.locator(".cm-content");
    await expect(editor).toContainText(`SELECT 2;</textarea><script>alert('xss-textarea')</script>`);

    // Không có dialog nào bật lên trong toàn bộ quá trình
    expect(dialogs).toEqual([]);
  });

  test("Ca biên: Mở share chứa payload độc hại trong iframe", async ({ page }) => {
    const dialogs = setupDialogSpy(page);
    const payload = await encodeSnapshot(XSS_SQL_SNAPSHOT);

    // Mở trang /vi và nhúng iframe trỏ tới /vi/share#d=...
    await page.goto("/vi");
    await page.evaluate((d) => {
      const iframe = document.createElement("iframe");
      iframe.id = "share-frame";
      iframe.src = `/vi/share#d=${d}`;
      iframe.style.width = "1000px";
      iframe.style.height = "700px";
      document.body.appendChild(iframe);
    }, payload);

    const frame = page.frameLocator("#share-frame");
    await expect(frame.getByTestId("readonly-workspace")).toBeVisible();

    // Editor trong iframe hiển thị an toàn
    const editorInFrame = frame.locator(".cm-content");
    await expect(editorInFrame).toBeVisible();
    await expect(editorInFrame).toContainText("<img src=x onerror=alert('xss-sql-img')>");

    // Trong iframe không có dialog nào bật lên
    expect(dialogs).toEqual([]);
  });

  test("Ca biên: Mở share chứa payload độc hại rồi bấm Fork vào workspace", async ({ page }) => {
    const dialogs = setupDialogSpy(page);
    const payload = await encodeSnapshot(XSS_NAMES_SNAPSHOT);

    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    // Bấm nút Fork để clone dự án vào IndexedDB cục bộ
    const forkBtn = page.getByTestId("share-fork-btn");
    await expect(forkBtn).toBeVisible();
    await forkBtn.click();

    // Điều hướng về màn hình chính
    await page.waitForURL((url) => !url.pathname.includes("/share"));

    // Không có script nào thực thi sau khi fork và render lại trong workspace
    expect(dialogs).toEqual([]);

    // Kiểm tra không có node HTML độc hại nào lọt vào DOM trang chính
    const evilNode = page.locator("#evil-proj-node");
    expect(await evilNode.count()).toBe(0);
  });

  test("AC3: Header Referrer-Policy: no-referrer có mặt trên /vi/share và /en/share", async ({ page }) => {
    // 1. Kiểm đúng response mà TRÌNH DUYỆT nhận được khi điều hướng thật, không phải một
    // request phụ cùng đường dẫn: header trên tài liệu là thứ quyết định referrer của trang.
    const navVi = await page.goto("/vi/share");
    if (!navVi) throw new Error("không nhận được response khi mở /vi/share");
    expect(navVi.headers()["referrer-policy"]).toBe("no-referrer");

    const navEn = await page.goto("/en/share");
    if (!navEn) throw new Error("không nhận được response khi mở /en/share");
    expect(navEn.headers()["referrer-policy"]).toBe("no-referrer");

    // 2. Kiểm tra thẻ <meta name="referrer" content="no-referrer"> trong DOM
    await page.goto("/vi/share");
    const meta = page.locator('meta[name="referrer"]');
    await expect(meta).toHaveAttribute("content", "no-referrer");
  });

  test("AC4: Khi điều hướng hoặc gửi request từ /share sang domain khác, request không mang Referer chứa payload", async ({
    page,
  }) => {
    const payload = await encodeSnapshot(XSS_SQL_SNAPSHOT);
    let capturedReferer: string | null = null;
    let requestCount = 0;

    // Đón bắt mọi request tới external domain
    await page.route("https://external-service.test/**", (route) => {
      requestCount++;
      capturedReferer = route.request().headers()["referer"] ?? null;
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "EXTERNAL_OK",
      });
    });

    await page.goto(`/vi/share#d=${payload}`);
    await expect(page.getByTestId("readonly-workspace")).toBeVisible();

    // 1. Kích hoạt fetch từ trang /vi/share sang external domain
    await page.evaluate(async () => {
      try {
        await fetch("https://external-service.test/api/ping", { mode: "no-cors" });
      } catch {
        // bỏ qua lỗi mạng
      }
    });

    expect(requestCount).toBeGreaterThanOrEqual(1);
    // Nhờ Referrer-Policy: no-referrer, header referer phải hoàn toàn rỗng/không có
    expect(capturedReferer).toBeNull();

    // 2. Click một liên kết ngoại điều hướng sang external domain
    capturedReferer = null;
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.id = "external-nav-link";
      link.href = "https://external-service.test/external-page";
      link.textContent = "External Link";
      document.body.appendChild(link);
    });

    const [request] = await Promise.all([
      page.waitForRequest("https://external-service.test/external-page"),
      page.locator("#external-nav-link").click(),
    ]);

    // Khẳng định header Referer hoàn toàn không có, hoặc tuyệt đối không chứa #d= hay fragment
    const navReferer = request.headers()["referer"] ?? null;
    expect(navReferer).toBeNull();
  });
});
