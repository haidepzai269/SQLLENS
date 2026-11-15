import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, reloadHydrated } from "./helpers";

// Bỏ qua /api/me để không hiện hộp thoại đăng nhập che màn hình
test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 503, body: "{}" }));
});

const editor = (p: Page) => p.locator(".cm-content:visible");
const editorText = async (p: Page) => {
  const el = await editor(p).elementHandle();
  if (!el) return "";
  const raw = await el.innerText();
  return raw.replace(/​/g, "").trim();
};

test.describe("Local-First Workspace Persistence (Task124)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 & AC5: Gõ SQL, F5 reload → nội dung còn nguyên 100%, không bị mất", async ({ page }) => {
    const testSql = "SELECT id, full_name, email FROM accounts WHERE is_active = true;";

    // 1. Mở trang Lab
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    // 2. Click vào editor và gõ câu SQL
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(testSql);

    // Chờ debounce autosave (300ms) lưu vào IndexedDB
    await page.waitForTimeout(500);

    // Kiểm tra editor đã có nội dung vừa gõ
    const typedText = await editorText(page);
    expect(typedText).toBe(testSql);

    // 3. F5 / Reload trang
    await reloadHydrated(page);
    await expect(editor(page)).toBeVisible();

    // 4. Kiểm tra nội dung sau reload khớp 100%
    // Đợi một chút để IndexedDB hydrate vào CodeMirror
    await expect.poll(async () => editorText(page), { timeout: 5000 }).toBe(testSql);
  });

  test("AC2: Không tạo trùng project hay tab sau khi reload", async ({ page }) => {
    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    // Gõ nội dung để kích hoạt autosave
    await editor(page).click();
    await page.keyboard.type("SELECT 1;");
    await page.waitForTimeout(500);

    // Reload lần 1
    await reloadHydrated(page);
    await expect(editor(page)).toBeVisible();
    await page.waitForTimeout(300);

    // Reload lần 2
    await reloadHydrated(page);
    await expect(editor(page)).toBeVisible();
    await page.waitForTimeout(300);

    // Kiểm tra trực tiếp trong IndexedDB: chỉ có đúng 1 project và 1 tab
    const counts = await page.evaluate(async () => {
      return new Promise<{ projects: number; tabs: number }>((resolve, reject) => {
        const req = indexedDB.open("sqllens-workspace", 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["projects", "tabs"], "readonly");
          const pReq = tx.objectStore("projects").count();
          const tReq = tx.objectStore("tabs").count();
          tx.oncomplete = () => {
            resolve({ projects: pReq.result, tabs: tReq.result });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    expect(counts.projects).toBe(1);
    expect(counts.tabs).toBe(1);
  });

  test("AC4: Core Rule 7 - Không có bất kỳ request mạng nào chứa nội dung SQL khi gõ", async ({ page }) => {
    const sensitiveKeyword = "super_secret_classified_table";
    const interceptedPayloads: string[] = [];

    // Theo dõi mọi request HTTP
    page.on("request", (req) => {
      const url = req.url();
      const postData = req.postData() ?? "";
      if (url.includes(sensitiveKeyword) || postData.includes(sensitiveKeyword)) {
        interceptedPayloads.push(`URL: ${url} | PostData: ${postData}`);
      }
    });

    await gotoHydrated(page, "/vi");
    await expect(editor(page)).toBeVisible();

    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`SELECT secret_key FROM ${sensitiveKeyword};`);

    // Chờ hơn thời gian autosave debounce
    await page.waitForTimeout(600);

    // Khẳng định 0 request chứa nội dung SQL
    expect(interceptedPayloads).toHaveLength(0);
  });
});
