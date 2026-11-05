import { expect, test, type Page } from "@playwright/test";
import { cfgFor, lastOf, simulateCfg, waitEdges } from "../src/modules/conflict-sim/ui/model";
import type { Tick } from "../src/modules/conflict-sim/engine/types";

const SHOTS = "../_bmad-output/SP011/STR051/Task070/anh";
type L = "vi" | "en";
const T = {
  vi: { run: "Chạy", pause: "Tạm dừng", next: "Bước tới", prev: "Bước lùi", reset: "Về đầu", pos: (c: number, n: number) => `Nhịp ${c} trên ${n}`, stage: "Mô phỏng", tab: "Tranh chấp", cycle: "deadlock", notSim: "Chưa mô phỏng được", sim: "Mô phỏng" },
  en: { run: "Run", pause: "Pause", next: "Step forward", prev: "Step back", reset: "Back to start", pos: (c: number, n: number) => `Tick ${c} of ${n}`, stage: "Simulation", tab: "Conflicts", cycle: "deadlock", notSim: "Cannot be simulated yet", sim: "Simulated" },
} as const;
const NAMES = {
  vi: ["Lost update", "Deadlock do cập nhật ngược thứ tự", "Write skew", "Double booking", "Non-repeatable read"],
  en: ["Lost update", "Deadlock from updates in reverse order", "Write skew", "Double booking", "Non-repeatable read"],
} as const;
const ID = { lost: "lost_update", dead: "deadlock_reverse_order" } as const;

const open = async (p: Page, l: L) => {
  await p.goto(`/${l}/e2e-conflict`);
  await expect(p.getByTestId("conflict-panel")).toBeVisible();
};
const ticksOf = (id: keyof typeof ID): Tick[] => {
  const r = simulateCfg(cfgFor(ID[id]));
  if (r.kind !== "conclusion") throw new Error("not simulated");
  return r.data.ticks;
};
const btn = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const pos = (p: Page) => p.getByTestId("cf-position");
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const rows = async (p: Page, id: string, table: string) => (await p.getByTestId(`tbl-${id}-${table}`).locator("tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
const expectRows = (tables: Tick["committed"] | undefined, table: string) =>
  (tables?.[table] ?? []).map((r) => Object.values(r).map(String).join(" "));

// Trạng thái đang hiện ở nhịp p phải khớp đúng với Timeline do simulate trả về.
async function matchesTimeline(p: Page, ticks: Tick[], at: number, table: string) {
  const base = ticks[0].committed;
  expect(await rows(p, "committed", table), `committed @${at}`).toEqual(expectRows(at ? ticks[at - 1].committed : base, table));
  for (const s of ["A", "B"] as const)
    expect(await rows(p, s, table), `${s} @${at}`).toEqual(expectRows(lastOf(ticks, at, s)?.snapshot ?? base, table));
  await expect(p.getByTestId("cf-ticks").locator("li[data-testid^=tick-]")).toHaveCount(at);
  if (at) await expect(p.getByTestId(`tick-sql-${at - 1}`)).toHaveText(ticks[at - 1].sql);
  const g = waitEdges(ticks, at);
  await expect(p.getByTestId("wait-graph")).toHaveAttribute("data-edges", String(g.edges.length));
  await expect(p.getByTestId("graph-summary").locator("li")).toHaveCount(g.edges.length ? g.edges.length + (g.cycle ? 1 : 0) : 1);
}

for (const l of ["vi", "en"] as const) {
  const t = T[l];
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    test.describe(`${l} ${w}`, () => {
      test.use({ viewport: { width: w, height: h } });

      test("AC1 đủ 5 kịch bản, không có dirty read, có mức cô lập và kiểu bảo vệ", async ({ page }) => {
        await open(page, l);
        const opts = await page.locator("#cf-scenario option").allInnerTexts();
        expect(opts).toEqual([...NAMES[l]]);
        expect(opts.join("|")).not.toMatch(/dirty/i);
        expect(await page.locator("#cf-isolation option").allInnerTexts()).toEqual(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]);
        await expect(page.locator("#cf-guard")).toHaveCount(0);
        await page.locator("#cf-scenario").selectOption("double_booking");
        await expect(page.locator("#cf-guard option")).toHaveCount(3);
        expect(await noHScroll(page)).toBe(true);
      });

      test("AC2 AC3 AC6 lost update: từng nhịp khớp Timeline, lùi trả đúng trạng thái", async ({ page }) => {
        await open(page, l);
        const ticks = ticksOf("lost");
        await page.setViewportSize({ width: w, height: w === 1440 ? 2600 : 3600 }); // chụp cả panel: trang cuộn trong vùng của shell
        await expect(pos(page)).toHaveText(t.pos(0, ticks.length));
        await expect(page.getByTestId("state-A")).toHaveAttribute("data-state", "idle");
        for (let i = 0; i <= ticks.length; i++) {
          if (i) await btn(page, t.next).click();
          await expect(pos(page)).toHaveText(t.pos(i, ticks.length));
          await matchesTimeline(page, ticks, i, "accounts");
          await page.getByTestId("conflict-panel").screenshot({ path: `${SHOTS}/${l}-${w}-lost-${String(i).padStart(2, "0")}.png` });
        }
        await expect(btn(page, t.next)).toBeDisabled();
        await expect(page.getByTestId("cf-outcome")).toHaveAttribute("data-outcome", "broken");
        await expect(page.getByTestId("state-A")).toHaveAttribute("data-state", "committed");
        for (let i = ticks.length - 1; i >= 0; i--) {
          await btn(page, t.prev).click();
          await matchesTimeline(page, ticks, i, "accounts");
        }
        await expect(btn(page, t.prev)).toBeDisabled();
        await expect(page.getByTestId("cf-outcome")).toHaveCount(0);
        expect(await noHScroll(page)).toBe(true);
      });

      test("AC3 AC6 deadlock: vòng chờ hiện đúng nhịp, bên bị hủy theo mô hình", async ({ page }) => {
        await open(page, l);
        await page.locator("#cf-scenario").selectOption(ID.dead);
        const ticks = ticksOf("dead");
        await page.setViewportSize({ width: w, height: w === 1440 ? 2600 : 3600 }); // chụp cả panel: trang cuộn trong vùng của shell
        const cycleAt = ticks.findIndex((k) => k.waiting.length === 2) + 1;
        for (let i = 0; i <= ticks.length; i++) {
          if (i) await btn(page, t.next).click();
          await matchesTimeline(page, ticks, i, "accounts");
          if (i === cycleAt) {
            await expect(page.getByTestId("graph-summary")).toContainText(/deadlock/i);
            await expect(page.getByTestId("wait-graph")).toHaveAttribute("data-cycle", "true");
          }
          await page.getByTestId("conflict-panel").screenshot({ path: `${SHOTS}/${l}-${w}-deadlock-${String(i).padStart(2, "0")}.png` });
        }
        const victim = ticks.find((k) => k.sqlstate === "40P01")!.session;
        await expect(page.getByTestId("cf-outcome")).toHaveAttribute("data-outcome", "deadlock");
        const msg = (await page.getByTestId("cf-outcome").innerText()).toLowerCase();
        expect(msg).toMatch(l === "vi" ? /postgresql thật có thể/ : /real postgresql may/);
        await expect(page.getByTestId(`state-${victim}`)).not.toHaveAttribute("data-state", "running");
      });

      test("AC4 nhãn Mô phỏng, đối chiếu CI, không thời gian chạy, not_broken không hàm ý thiết kế ổn", async ({ page }) => {
        await open(page, l);
        await expect(page.getByTestId("cf-label")).toHaveText(t.sim);
        await expect(page.getByTestId("conflict-panel")).toContainText(l === "vi" ? "PostgreSQL thật trong CI" : "real PostgreSQL in CI");
        await page.locator("#cf-scenario").selectOption("double_booking");
        await page.locator("#cf-guard").selectOption("unique");
        for (let i = 0; i < 30 && (await btn(page, t.next).isEnabled()); i++) await btn(page, t.next).click();
        const out = page.getByTestId("cf-outcome");
        await expect(out).toHaveAttribute("data-outcome", "not_broken");
        await expect(out).toContainText(l === "vi" ? "kịch bản này ở mức cô lập này" : "this scenario at this isolation level");
        const all = await page.getByTestId("conflict-panel").innerText();
        expect(all).not.toMatch(/thiết kế (này )?(đã )?ổn|design is (fine|ok|good)/i);
        expect(all).not.toMatch(/\d\s?(ms|giây|seconds?)\b/i);
      });

      test("AC4 NotSimulated hiện lý do, không có timeline", async ({ page }) => {
        await open(page, l);
        await page.locator("#cf-scenario").selectOption("double_booking");
        await page.locator("#cf-guard").selectOption("unique");
        await page.locator("#cf-isolation").selectOption("serializable");
        const n = page.getByTestId("cf-not-simulated");
        await expect(n).toContainText(t.notSim);
        await expect(n).toContainText(l === "vi" ? "SERIALIZABLE" : "SERIALIZABLE");
        await expect(page.getByTestId("cf-ticks")).toHaveCount(0);
        await expect(page.getByTestId("cf-label")).toHaveCount(0);
        await page.screenshot({ path: `${SHOTS}/${l}-${w}-not-simulated.png` });
      });

      test("AC6 đổi kịch bản hoặc mức cô lập giữa lúc chạy thì dừng và dựng lại", async ({ page }) => {
        await open(page, l);
        const n = ticksOf("lost").length;
        await btn(page, t.run).click();
        await btn(page, t.run).click(); // bấm Chạy liên tục không tạo hai bộ đếm
        await expect(pos(page)).toHaveText(t.pos(2, n), { timeout: 4000 }); // 1 s mỗi nhịp, không phải 0,5 s
        await page.locator("#cf-isolation").selectOption("repeatable_read");
        const n2 = (() => {
          const r = simulateCfg({ ...cfgFor(ID.lost), isolation: "repeatable_read" });
          return r.kind === "conclusion" ? r.data.ticks.length : -1;
        })();
        await expect(pos(page)).toHaveText(t.pos(0, n2));
        await page.waitForTimeout(1500);
        await expect(pos(page)).toHaveText(t.pos(0, n2));
        await expect(page.getByTestId("cf-ticks").locator("li[data-testid^=tick-]")).toHaveCount(0);
        await btn(page, t.run).click();
        await page.locator("#cf-scenario").selectOption(ID.dead);
        await page.waitForTimeout(1500);
        await expect(pos(page)).toHaveText(t.pos(0, ticksOf("dead").length));
      });

      test("Ca biên: tạm dừng, tua khi đang chạy, đổi tab rồi quay lại, đổi cỡ cửa sổ", async ({ page }) => {
        await open(page, l);
        const n = ticksOf("dead").length;
        await page.locator("#cf-scenario").selectOption(ID.dead);
        await btn(page, t.run).click();
        await expect(pos(page)).toHaveText(t.pos(1, n), { timeout: 3000 });
        await btn(page, t.pause).click();
        await page.waitForTimeout(1500);
        await expect(pos(page)).toHaveText(t.pos(1, n));
        await btn(page, t.run).click();
        await page.getByTestId("cf-seek").fill("0");
        await expect(pos(page)).toHaveText(t.pos(0, n));
        await page.waitForTimeout(1300);
        await expect(pos(page)).toHaveText(t.pos(0, n)); // tua là dừng
        const cycleAt = ticksOf("dead").findIndex((k) => k.waiting.length === 2) + 1;
        await page.getByTestId("cf-seek").fill(String(cycleAt));
        await expect(page.getByTestId("wait-graph")).toHaveAttribute("data-cycle", "true");
        const w0 = (await page.getByTestId("wait-graph").boundingBox())!.width;
        await page.setViewportSize({ width: w === 1440 ? 700 : 340, height: 800 });
        await expect.poll(async () => (await page.getByTestId("wait-graph").boundingBox())!.width).toBeLessThanOrEqual(w0);
        await expect(page.getByTestId("wait-graph").locator("canvas").first()).toBeVisible();
        expect(await noHScroll(page)).toBe(true);
        await page.getByRole("button", { name: "toggle", exact: true }).click(); // gỡ rồi dựng lại: không giữ trạng thái cũ
        await expect(page.getByTestId("conflict-panel")).toHaveCount(0);
        await page.getByRole("button", { name: "toggle", exact: true }).click();
        await expect(page.getByTestId("conflict-panel")).toBeVisible();
        await expect(page.locator("#cf-scenario")).toHaveValue("lost_update");
      });
    });
  }
}

test("Giảm chuyển động: điều khiển vẫn dùng được bằng bàn phím", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "vi");
  await btn(page, T.vi.next).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(pos(page)).toContainText("Nhịp 2");
  await page.getByTestId("cf-seek").focus();
  await page.keyboard.press("ArrowRight");
  await expect(pos(page)).toContainText("Nhịp 3");
});

test("tab Tranh chấp trong vùng stage của lab", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vi");
  await page.locator(".cm-content:visible").first().fill("CREATE TABLE t(id int); SELECT 1 AS n");
  await page.getByRole("button", { name: "Chạy", exact: true }).first().click();
  await expect(page.locator("tbody:visible tr")).toHaveCount(1, { timeout: 90_000 });
  const stage = page.locator("#stage");
  await stage.getByRole("tab", { name: T.vi.tab, exact: true }).click();
  await expect(stage.getByTestId("conflict-panel")).toBeVisible();
  await stage.getByRole("button", { name: T.vi.next, exact: true }).click();
  await expect(stage.getByTestId("cf-position")).toContainText("Nhịp 1");
  await page.screenshot({ path: `${SHOTS}/vi-1440-stage-tab.png` });
});
