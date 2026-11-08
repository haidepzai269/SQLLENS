import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, throttleCpu } from "./helpers";

test.beforeEach(({ page }) => throttleCpu(page));

type L = "vi" | "en";
const T = {
  vi: {
    next: "Bước tới",
    reset: "Khôi phục mặc định",
    disabledNote: "Đã tắt tiêu chí kiểm tra dữ liệu",
    notSim: "Chưa mô phỏng được",
  },
  en: {
    next: "Step forward",
    reset: "Reset to default",
    disabledNote: "Data check criteria disabled",
    notSim: "Cannot be simulated yet",
  },
} as const;

const open = async (p: Page, l: L) => {
  await gotoHydrated(p, `/${l}/e2e-conflict`);
  await expect(p.getByTestId("conflict-panel")).toBeVisible();
};

const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const l of ["vi", "en"] as const) {
  const t = T[l];
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    test.describe(`conflict criteria ${l} ${w}`, () => {
      test.use({ viewport: { width: w, height: h } });

      test("AC1 tiêu chí mặc định tương ứng với 5 kịch bản mẫu", async ({ page }) => {
        await open(page, l);

        // 1. lost_update (mặc định ban đầu)
        await expect(page.getByTestId("cf-check-enable")).toBeChecked();
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT balance FROM accounts WHERE id = 1");
        await expect(page.getByTestId("cf-check-op")).toHaveValue("<>");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("130");

        // 2. deadlock_reverse_order
        await page.locator("#cf-scenario").selectOption("deadlock_reverse_order");
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT balance FROM accounts WHERE id = 1");
        await expect(page.getByTestId("cf-check-op")).toHaveValue("<>");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("100");

        // 3. write_skew
        await page.locator("#cf-scenario").selectOption("write_skew");
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT count(*) FROM doctors WHERE on_call = true");
        await expect(page.getByTestId("cf-check-op")).toHaveValue("=");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("0");

        // 4. double_booking
        await page.locator("#cf-scenario").selectOption("double_booking");
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT count(*) FROM bookings WHERE slot = 1");
        await expect(page.getByTestId("cf-check-op")).toHaveValue(">");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("1");

        // 5. non_repeatable_read
        await page.locator("#cf-scenario").selectOption("non_repeatable_read");
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT balance FROM accounts WHERE id = 1");
        await expect(page.getByTestId("cf-check-op")).toHaveValue("<>");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("100");

        expect(await noHScroll(page)).toBe(true);
      });

      test("AC2 AC3 tắt tiêu chí hiển thị ghi chú, kết quả ra no_criteria không hàm ý thiết kế ổn", async ({ page }) => {
        await open(page, l);
        await expect(page.getByTestId("cf-check-sql")).toBeVisible();

        // Tắt checkbox tiêu chí
        await page.getByTestId("cf-check-enable").uncheck();
        await expect(page.getByTestId("cf-check-sql")).toHaveCount(0);
        await expect(page.getByTestId("cf-criteria-disabled-note")).toContainText(t.disabledNote);

        // Chạy hết các nhịp bằng cách tua slider về cuối
        const maxVal = await page.getByTestId("cf-seek").getAttribute("max");
        await page.getByTestId("cf-seek").fill(maxVal ?? "7");

        // Kết quả hiển thị no_criteria
        const outcome = page.getByTestId("cf-outcome");
        await expect(outcome).toBeVisible();
        await expect(outcome).toHaveAttribute("data-outcome", "no_criteria");
        await expect(outcome).not.toHaveClass(/border-severity-broken/);
        await expect(outcome).toHaveClass(/border-line/);

        // Đảm bảo không vi phạm nguyên tắc 2: không nói thiết kế ổn
        const text = await outcome.innerText();
        expect(text).not.toMatch(/thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design|safe/i);
        expect(text).toMatch(l === "vi" ? /kịch bản này ở mức cô lập này/ : /this scenario at this isolation level/);

        // Không có dòng observed khi no_criteria
        await expect(page.locator("text=" + (l === "vi" ? "Giá trị mô hình đọc được ở cuối" : "Value the model read at the end"))).toHaveCount(0);
        expect(await noHScroll(page)).toBe(true);
      });

      test("AC4 AC5 tùy biến câu SELECT, toán tử, ngưỡng và khôi phục mặc định", async ({ page }) => {
        await open(page, l);

        // Đổi sang kiểm tra: balance = 120 (trong lost_update, balance cuối là 120 -> nên broken)
        await page.getByTestId("cf-check-op").selectOption("=");
        await page.getByTestId("cf-check-target").fill("120");

        // Tua đến cuối
        const maxVal = await page.getByTestId("cf-seek").getAttribute("max");
        await page.getByTestId("cf-seek").fill(maxVal ?? "7");

        const outcome = page.getByTestId("cf-outcome");
        await expect(outcome).toBeVisible();
        await expect(outcome).toHaveAttribute("data-outcome", "broken");

        // Đổi sang kiểm tra: balance = 999 (balance là 120 != 999 -> not_broken)
        await page.getByTestId("cf-check-target").fill("999");
        await page.getByTestId("cf-seek").fill(maxVal ?? "7");
        await expect(page.getByTestId("cf-outcome")).toHaveAttribute("data-outcome", "not_broken");

        // Bấm nút Khôi phục mặc định
        await page.getByTestId("cf-check-reset").click();
        await expect(page.getByTestId("cf-check-sql")).toHaveValue("SELECT balance FROM accounts WHERE id = 1");
        await expect(page.getByTestId("cf-check-op")).toHaveValue("<>");
        await expect(page.getByTestId("cf-check-target")).toHaveValue("130");

        // Kết quả khi về mặc định với lost_update (balance 120 <> 130) -> broken
        await page.getByTestId("cf-seek").fill(maxVal ?? "7");
        await expect(page.getByTestId("cf-outcome")).toHaveAttribute("data-outcome", "broken");
      });

      test("Ca biên: kịch bản deadlock khi tắt tiêu chí vẫn phát hiện deadlock", async ({ page }) => {
        await open(page, l);
        await page.locator("#cf-scenario").selectOption("deadlock_reverse_order");
        await page.getByTestId("cf-check-enable").uncheck();

        const maxVal = await page.getByTestId("cf-seek").getAttribute("max");
        await page.getByTestId("cf-seek").fill(maxVal ?? "7");

        const outcome = page.getByTestId("cf-outcome");
        await expect(outcome).toBeVisible();
        await expect(outcome).toHaveAttribute("data-outcome", "deadlock");
      });

      test("Ca biên: nhập SQL không hợp lệ hiển thị Chưa mô phỏng được mà không crash", async ({ page }) => {
        await open(page, l);

        // Nhập SQL không phải SELECT (ví dụ UPDATE)
        await page.getByTestId("cf-check-sql").fill("UPDATE accounts SET balance = 0 WHERE id = 1");

        // Giao diện hiển thị lỗi an toàn NotSimulated
        const notSim = page.getByTestId("cf-not-simulated");
        await expect(notSim).toBeVisible();
        await expect(notSim).toContainText(t.notSim);

        // Bấm Reset để khôi phục
        await page.getByTestId("cf-check-reset").click();
        await expect(notSim).toHaveCount(0);
        await expect(page.getByTestId("cf-label")).toBeVisible();
      });
    });
  }
}
