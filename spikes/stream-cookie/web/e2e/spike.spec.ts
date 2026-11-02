import { test, expect } from "@playwright/test";

async function run(page: import("@playwright/test").Page, base: string) {
  await page.goto(`/?base=${base}`);
  await page.getByRole("button", { name: "Chạy" }).click();
  await expect(page.locator("#out")).toContainText("chunks", { timeout: 15_000 });
  return JSON.parse((await page.locator("#out").textContent())!);
}

test("AC1 cookie sid nằm trên domain Next và /me nhận lại", async ({ page, context }) => {
  const r = await run(page, "/api");
  expect(r.me.has).toBe(true);
  expect(r.me.sid).toBe("spike-session");
  const c = (await context.cookies()).find((x) => x.name === "sid")!;
  console.log("cookie", JSON.stringify(c));
  expect(c.domain).toBe("localhost");
  // Cổng không nằm trong cookie, nên domain một mình không phân biệt Next với Go. Bằng chứng thật: Go không đặt Domain.
  const sc = (await page.request.get("/api/login")).headersArray().find((h) => h.name.toLowerCase() === "set-cookie")!.value;
  expect(sc).not.toMatch(/domain=/i);
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe("Lax");
  expect(c.path).toBe("/");
  // HttpOnly: JS không đọc được
  expect(await page.evaluate(() => document.cookie)).not.toContain("sid");
});

test("AC2 stream rải theo thời gian", async ({ page }) => {
  const r = await run(page, "/api");
  console.log("stream", r.contentType, "chunks", r.chunks.length, "spanMs", r.spanMs);
  expect(r.chunks.length).toBeGreaterThan(5);
  expect(r.spanMs).toBeGreaterThan(2000);
});
