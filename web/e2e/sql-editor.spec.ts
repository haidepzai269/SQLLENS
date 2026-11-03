import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

const SHOTS = "../_bmad-output/SP006/STR025/Task029";
const content = (p: Page) => p.locator(".cm-content");
const open = async (p: Page, url = "/vi/e2e-editor") => {
  await p.goto(url);
  await content(p).waitFor();
};
const text = (p: Page) => content(p).evaluate((el) => (el as HTMLElement).innerText.replace(/​/g, ""));
const paste = (p: Page, s: string) =>
  content(p).evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", data);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, s);

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 đổi engine giữ nội dung và con trỏ", async ({ page }) => {
    await open(page);
    await content(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("SELECT abc FROM t;");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft"); // con trỏ về trước chữ c
    await page.getByRole("button", { name: "my" }).click();
    await expect(page.getByTestId("engine")).toHaveText("mysql");
    expect(await text(page)).toBe("SELECT abc FROM t;");
    await page.getByRole("button", { name: "pg" }).click();
    // gõ đúng chỗ con trỏ cũ (sau phần đã lùi): nếu mất con trỏ thì ký tự sẽ vào cuối hoặc đầu
    await content(page).focus();
    await page.keyboard.type("X");
    expect(await text(page)).toBe("SELECT abXc FROM t;");
  });

  test("AC2/ca biên: tô đúng ký tự, lề, thông báo, CRLF, HTML, vượt độ dài, bỏ lỗi", async ({ page }) => {
    await open(page);
    await page.getByLabel("pos").fill("7");
    await page.getByRole("button", { name: "mark" }).click();
    await expect(page.locator(".cm-sql-error")).toHaveText("1");
    await expect(page.locator(".cm-sql-error-gutter .cm-gutterElement").filter({ hasText: "!" })).toHaveCount(1);
    const alert = page.locator("p[role=alert]");
    await expect(alert).toHaveText("Lỗi <b>thử</b> ở đây"); // HTML hiện dạng chữ
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-invalid", "true");
    await expect(alert.locator("b")).toHaveCount(0);

    await page.getByRole("button", { name: "clear" }).click();
    await expect(page.locator(".cm-sql-error")).toHaveCount(0);
    await expect(page.locator("p[role=alert]")).toHaveCount(0);

    await page.getByLabel("pos").fill("99999");
    await page.getByRole("button", { name: "mark" }).click();
    await expect(page.locator(".cm-sql-error")).toHaveText(";"); // vượt độ dài: tô ký tự cuối, không sập
    await page.getByRole("button", { name: "clear" }).click();

    // CRLF: "SELECT 1;\r\n" dài 11 ký tự, vị trí 11 là chữ S của dòng hai
    await page.getByRole("button", { name: "crlf" }).click();
    await page.getByLabel("pos").fill("11");
    await page.getByRole("button", { name: "mark" }).click();
    await expect(page.locator(".cm-sql-error")).toHaveText("S");
    expect(await page.locator(".cm-sql-error").evaluate((e) => e.closest(".cm-line")!.textContent)).toBe("SELECT 2;");
    await expect(page.locator(".cm-gutterElement").filter({ hasText: "!" })).toHaveCount(1);
    // vị trí trỏ vào CR hoặc LF của CRLF: lỗi ở dòng một, không nhảy sang dòng hai
    for (const pos of ["9", "10"]) {
      await page.getByLabel("pos").fill(pos);
      await page.getByRole("button", { name: "mark" }).click();
      const rows = await page.locator(".cm-lineNumbers .cm-gutterElement").evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility !== "hidden").map((e) => e.textContent));
      const marks = await page.locator(".cm-sql-error-gutter .cm-gutterElement").evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility !== "hidden").map((e) => e.textContent));
      expect(marks.indexOf("!")).toBe(rows.indexOf("1")); // dấu ở lề cùng hàng với dòng 1
    }
  });

  test("AC3 dòng dài tự xuống dòng, số dòng theo dòng logic", async ({ page }) => {
    await open(page);
    await content(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await paste(page, `SELECT ${"a, ".repeat(200)}b FROM t;\nSELECT 2;`);
    const line1 = page.locator(".cm-line").first();
    expect((await line1.boundingBox())!.height).toBeGreaterThan(40); // nhiều dòng hiển thị
    // bỏ phần tử đệm ẩn mà CodeMirror dùng để đo bề rộng lề
    const nums = await page
      .locator(".cm-lineNumbers .cm-gutterElement")
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility !== "hidden").map((e) => e.textContent));
    expect(nums).toEqual(["1", "2"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("AC4 Tab thụt lề, Esc rồi Tab thoát khỏi ô", async ({ page }) => {
    await open(page);
    await content(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("x");
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    expect(await text(page)).toMatch(/^\s+x$/);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "ngoài" })).toBeFocused();
  });

  test("ca biên: nạp mẫu từ ngoài không gọi onChange", async ({ page }) => {
    await open(page, "/en/e2e-editor");
    await page.getByRole("button", { name: "Load sample" }).click();
    await expect(content(page)).toContainText("CREATE INDEX");
    await expect(page.getByTestId("changes")).toHaveText("0");
    await page.getByRole("button", { name: "my" }).click();
    await page.getByRole("button", { name: "Load sample" }).click();
    await expect(content(page)).toContainText("AUTO_INCREMENT");
    await expect(page.getByTestId("changes")).toHaveText("0");
    await content(page).click();
    await page.keyboard.type("z");
    await expect(page.getByTestId("changes")).toHaveText("1");
  });

  test("vi: nút mẫu có chữ tiếng Việt", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Nạp câu mẫu" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/anh_1440.png` });
  });

  test("AC6 dán 1 MB không có khung nào chờ quá 500 ms", async ({ page }) => {
    await open(page);
    await content(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate(() => {
      const w = window as unknown as { maxGap: number };
      w.maxGap = 0;
      let last = performance.now();
      const tick = (t: number) => {
        w.maxGap = Math.max(w.maxGap, t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const line = "INSERT INTO t (a, b, c) VALUES (1, 'hello world', 3.14);\n";
    const big = line.repeat(Math.ceil(1_048_576 / line.length));
    await paste(page, big);
    await expect(page.locator(".cm-lineNumbers")).toContainText("1"); // đã vẽ xong
    await page.waitForTimeout(1500);
    const gap = await page.evaluate(() => (window as unknown as { maxGap: number }).maxGap);
    console.log(`AC6 maxGap=${Math.round(gap)}ms, size=${big.length}`);
    expect(gap).toBeLessThan(500);
    // dòng quá dài một dòng cũng không treo
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate(() => ((window as unknown as { maxGap: number }).maxGap = 0));
    await paste(page, `SELECT ${"a,".repeat(500_000)}b;`);
    await page.waitForTimeout(1500);
    await expect(content(page)).toContainText("a,a,a,a"); // đã thay hết nội dung cũ
    await expect(content(page)).not.toContainText("INSERT");
    const gap2 = await page.evaluate(() => (window as unknown as { maxGap: number }).maxGap);
    console.log(`AC6 một dòng 1 MB maxGap=${Math.round(gap2)}ms`);
    expect(gap2).toBeLessThan(500);
  });
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("AC5 không cuộn ngang, chữ >= 16px, dán được", async ({ page }) => {
    await open(page, "/en/e2e-editor");
    await content(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await paste(page, `SELECT ${"column_name, ".repeat(40)}x FROM some_table;`);
    await expect(content(page)).toContainText("column_name");
    const size = await content(page).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // ô giữ đúng chiều cao do trang cấp, nội dung dài cuộn bên trong ô
    const box = (await page.locator(".cm-editor").boundingBox())!;
    expect(box.height).toBeLessThan(300);
    expect(await page.locator(".cm-scroller").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await page.getByLabel("pos").fill("20");
    await page.getByRole("button", { name: "mark" }).click();
    await expect(page.locator(".cm-sql-error")).toHaveCount(1);
    await page.locator(".cm-scroller").evaluate((e) => (e.scrollTop = 0)); // ảnh chụp thấy chỗ lỗi
    await page.screenshot({ path: `${SHOTS}/anh_390.png` });
  });
});

test("AC7 JS của ô soạn không nằm trong bundle ban đầu của /vi", async ({ page }) => {
  const scan = async (url: string) => {
    const hits: number[] = [];
    page.on("response", async (r) => {
      if (!r.url().endsWith(".js") && !r.url().includes(".js?")) return;
      const body = await r.body().catch(() => null);
      if (body && body.toString("utf8").includes("cm-content")) hits.push(gzipSync(body).length);
    });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    return hits;
  };
  expect(await scan("/vi")).toEqual([]);
  const hits = await scan("/vi/e2e-editor");
  expect(hits.length).toBeGreaterThan(0);
  console.log(`AC7 editor chunk gzip=${hits.reduce((a, b) => a + b, 0)} bytes`);
});
