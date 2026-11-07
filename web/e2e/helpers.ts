import { expect, type Page } from "@playwright/test";

// CPU_THROTTLE=4 làm chậm CPU 4 lần để tái hiện máy CI yếu. Gọi trong beforeEach.
export async function throttleCpu(page: Page) {
  const rate = Number(process.env.CPU_THROTTLE ?? 1);
  if (rate > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate });
}

// ShellProvider đặt data-hydrated trên <html> sau khi React gắn sự kiện. Bấm hay chọn trước lúc đó thì sự kiện mất,
// hoặc React đặt lại giá trị về state ban đầu.
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
}

export async function reloadHydrated(page: Page) {
  await page.reload();
  await expect(page.locator("html[data-hydrated]")).toHaveCount(1);
}
