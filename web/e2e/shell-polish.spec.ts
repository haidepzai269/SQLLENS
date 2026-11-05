import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, throttleCpu } from "./helpers";

// Task064: thanh cuộn, menu bánh răng, tooltip, chuyển động đóng mở cột, viền focus ô SQL.
// Ảnh chụp ghi vào thư mục task để người duyệt tự mở xem.
const OUT = "../_bmad-output/SP999/STR062/Task064/anh/";
const SQL = "CREATE TABLE t(id int primary key, v int); SELECT * FROM t;";

test.beforeEach(async ({ page }) => {
  await throttleCpu(page);
  await page.route("**/api/me", (r) => r.fulfill({ status: 503, body: "{}" }));
});

const L = {
  vi: { gear: "Bố cục: bật tắt các vùng", run: "Chạy", sql: /Cột SQL/, stage: /Vùng mô phỏng/, findings: /Cột rủi ro/, term: /Terminal/ },
  en: { gear: "Layout: show or hide panels", run: "Run", sql: /SQL column/, stage: /Simulation area/, findings: /Risk column/, term: /Terminal/ },
} as const;
// Chụp quanh ô SQL bằng clip của trang (chụp phần tử có thể làm mất focus), chừa 8px để thấy cả ring.
const crop = async (p: Page, path: string) => {
  const b = (await p.locator("#sql-input").boundingBox())!;
  await p.screenshot({ path, clip: { x: Math.max(0, b.x - 8), y: b.y - 8, width: b.width + 16, height: Math.min(b.height + 16, 260) } });
};
const gear = (p: Page, l: keyof typeof L) => p.getByRole("button", { name: L[l].gear });
const item = (p: Page, name: RegExp) => p.getByRole("menuitemcheckbox", { name });
const editor = (p: Page) => p.locator(".cm-content:visible");
const open = async (p: Page, l: keyof typeof L) => {
  await gotoHydrated(p, `/${l}/lab`);
  await editor(p).waitFor();
};
const w = (p: Page, id: string) => p.locator(`#${id}`).evaluate((e) => e.getBoundingClientRect().width);
const flip = async (p: Page, l: keyof typeof L, name: RegExp) => {
  await gear(p, l).click();
  await item(p, name).click();
  await p.keyboard.press("Escape");
};
// Ghi bề rộng của #id ở mỗi khung hình tới khi `stop()` được gọi.
const sample = (p: Page, sel: string, prop: "width" | "height" = "width") =>
  p.evaluate(
    ([s, pr]) => {
      const out: number[] = [];
      const el = document.querySelector<HTMLElement>(s);
      let on = true;
      // Số khung hình trong 260 ms phụ thuộc máy; chuyển động có chạy thật hay không thì đọc từ sự kiện transition.
      const w = window as unknown as { transitions: string[] };
      w.transitions = [];
      for (const ev of ["transitionrun", "transitionend"]) el?.addEventListener(ev, (e) => w.transitions.push(`${ev}:${(e as TransitionEvent).propertyName}`));
      (window as unknown as { stopSample: () => number[] }).stopSample = () => ((on = false), out);
      const tick = () => {
        out.push(el ? el.getBoundingClientRect()[pr as "width"] : 0);
        if (on) requestAnimationFrame(tick);
      };
      tick();
    },
    [sel, prop],
  );
const stopSample = (p: Page) => p.evaluate(() => (window as unknown as { stopSample: () => number[] }).stopSample());
// Sự kiện transition của vùng đang được `sample` theo dõi: chuyển động chạy thật khi có cả run và end của thuộc tính.
const expectTransition = (p: Page, prop: "width" | "height") =>
  expect.poll(() => p.evaluate(() => (window as unknown as { transitions: string[] }).transitions), { message: `transition ${prop}` }).toEqual(expect.arrayContaining([`transitionrun:${prop}`, `transitionend:${prop}`]));
const angle = (p: Page) =>
  p.evaluate(() => {
    const el = document.querySelector("button[aria-haspopup='menu'] svg")!;
    const v = getComputedStyle(el).rotate; // Tailwind v4 dùng thuộc tính rotate, không phải transform
    return v === "none" ? 0 : Math.round(parseFloat(v));
  });

test.describe("máy tính 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("AC1 thanh cuộn mảnh, mờ, đậm lên khi hover, không đổi bề rộng", async ({ page }) => {
    await open(page, "en");
    for (const sel of ["#sql", "#terminal", "#stage", "#findings", ".cm-scroller", "#content"]) {
      const t = await page.locator(sel).first().evaluate((e) => getComputedStyle(e).scrollbarWidth);
      expect(t, sel).toBe("thin");
    }
    const el = page.locator("#sql");
    await page.mouse.move(5, 5);
    const idle = await el.evaluate((e) => getComputedStyle(e).scrollbarColor);
    await el.hover();
    // scrollbar-color có transition 0,2 giây: đợi tới khi đổi màu.
    await expect.poll(() => el.evaluate((e) => getComputedStyle(e).scrollbarColor)).not.toBe(idle);
    const hot = await el.evaluate((e) => getComputedStyle(e).scrollbarColor);
    expect(hot).not.toBe(idle);
    expect(await el.evaluate((e) => getComputedStyle(e).scrollbarWidth)).toBe("thin");
    await page.mouse.move(5, 5);
  });

  for (const l of ["vi", "en"] as const) {
    test(`AC2 ${l}: bánh răng gom bốn vùng, bàn phím, giữ menu mở khi bấm, ngôn ngữ ở ngoài menu`, async ({ page }) => {
      await open(page, l);
      // Bốn nút icon cũ đã biến mất, chỉ còn một nút bánh răng.
      await expect(page.getByRole("button", { name: L[l].sql })).toHaveCount(0);
      const g = gear(page, l);
      await expect(g).toHaveAttribute("aria-haspopup", "menu");
      await expect(page.getByRole("group", { name: l === "vi" ? "Ngôn ngữ" : "Language" }).or(page.getByRole("button", { name: l === "vi" ? "Tiếng Việt" : "English" })).first()).toBeVisible();
      await g.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitemcheckbox")).toHaveCount(4);
      for (const n of [L[l].sql, L[l].stage, L[l].findings, L[l].term]) await expect(item(page, n)).toHaveAttribute("aria-checked", "true");
      await page.screenshot({ path: `${OUT}sau-1440-${l}-menu-mo.png` });
      // Bấm mục bằng chuột không đóng menu.
      await item(page, L[l].sql).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(item(page, L[l].sql)).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("#sql")).toHaveCount(0);
      // Bàn phím: mũi tên rồi Space bật lại, menu vẫn mở.
      await item(page, L[l].sql).focus();
      await page.keyboard.press("Space");
      await expect(page.locator("#sql")).toBeVisible();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(g).toBeFocused();
    });

    test(`AC2 ${l}: bánh răng quay khi mở và quay về khi đóng, nhiều khung hình`, async ({ page }) => {
      await open(page, l);
      const g = gear(page, l);
      expect(await angle(page)).toBe(0);
      await sample(page, "body");
      await g.click();
      await page.waitForTimeout(450);
      expect(await angle(page)).toBe(90);
      await page.screenshot({ path: `${OUT}sau-1440-${l}-banh-rang-quay-90.png`, clip: { x: 1000, y: 0, width: 440, height: 300 } });
      await stopSample(page);
      // Lấy mẫu góc quay lúc đóng.
      const angles = await page.evaluate(async () => {
        const el = document.querySelector("button[aria-haspopup='menu'] svg")!;
        const out: number[] = [];
        const read = () => {
          const v = getComputedStyle(el).rotate;
          out.push(v === "none" ? 0 : Math.round(parseFloat(v)));
        };
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        for (let i = 0; i < 30; i++) {
          read();
          await new Promise((r) => requestAnimationFrame(r));
        }
        return out;
      });
      console.log(`gear ${l} close angles`, angles.join(","));
      await page.keyboard.press("Escape");
      await expect.poll(() => angle(page)).toBe(0);
      const mid = angles.filter((a) => a > 2 && a < 88);
      expect(mid.length, `góc trung gian khi đóng: ${angles}`).toBeGreaterThan(2);
    });

    test(`AC3 ${l}: tooltip khi hover và focus, có chữ chỉ dẫn, nút có chữ vẫn có tooltip nói thêm`, async ({ page }) => {
      await open(page, l);
      const tip = page.locator("[data-slot=tooltip-content][data-open]");
      await gear(page, l).hover();
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(l === "vi" ? "Chọn vùng nào hiện" : "Choose which panels");
      await page.screenshot({ path: `${OUT}sau-1440-${l}-tooltip-banh-rang.png`, clip: { x: 900, y: 0, width: 540, height: 160 } });
      await page.mouse.move(700, 500);
      await expect(tip).toHaveCount(0);
      // Focus bằng bàn phím cũng hiện.
      await page.getByRole("tab", { name: "MySQL" }).focus();
      await expect(tip.filter({ hasText: l === "vi" ? "MySQL thật" : "real MySQL" })).toBeVisible();
      // Nút Chạy trong cột SQL: tooltip không lặp chữ trên nút.
      await editor(page).click();
      await page.keyboard.type("SELECT 1;");
      const run = page.getByRole("button", { name: L[l].run, exact: true });
      await run.hover();
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(l === "vi" ? "Tách SQL" : "Split the SQL");
      expect((await tip.innerText()).trim()).not.toBe(L[l].run);
      await page.screenshot({ path: `${OUT}sau-1440-${l}-tooltip-chay.png`, clip: { x: 0, y: 340, width: 700, height: 260 } });
    });

    test(`AC3 ${l}: tooltip nút điều khiển trong stage, và ô SQL focus có viền đều`, async ({ page }) => {
      test.setTimeout(120_000);
      await open(page, l);
      await editor(page).click();
      await expect(page.locator(".cm-editor.cm-focused")).toHaveCount(1);
      // AC5: lớp phủ ring hiện đủ, và biến mất khi rời.
      const ring = () => page.locator("#sql-input > div").first().evaluate((e) => getComputedStyle(e, "::after").opacity);
      await expect.poll(ring).toBe("1");
      await page.keyboard.type(SQL);
      await page.screenshot({ path: `${OUT}sau-1440-${l}-sql-focus.png` });
      await crop(page, `${OUT}sau-1440-${l}-sql-focus-crop.png`);
      await page.getByRole("button", { name: L[l].run, exact: true }).click();
      const planTab = page.getByRole("tab", { name: "Plan" });
      await expect(planTab).toBeVisible({ timeout: 90_000 });
      await page.mouse.move(700, 700);
      await expect.poll(ring).toBe("0");
      await planTab.hover();
      await expect(page.locator("[data-slot=tooltip-content][data-open]")).toContainText(l === "vi" ? "database chạy câu SELECT" : "the database takes for the SELECT");
      await page.screenshot({ path: `${OUT}sau-1440-${l}-tooltip-stage.png`, clip: { x: 320, y: 40, width: 800, height: 200 } });
    });
  }

  test("AC4 đóng mở cột co giãn dần, về đúng độ rộng cũ, bấm liên tục không hỏng", async ({ page }) => {
    await open(page, "en");
    const before = await w(page, "sql");
    const stageBefore = await w(page, "stage");
    await sample(page, "[data-zone=sql]");
    await flip(page, "en", L.en.sql);
    await page.waitForTimeout(500);
    const closing = await stopSample(page);
    console.log("sql closing widths", closing.map(Math.round).join(","));
    expect(closing[0]).toBeGreaterThan(before - 2);
    expect(closing.at(-1)).toBe(0);
    // Easing dốc ở đầu, CI chậm chỉ lấy được vài khung (có khi 0 khung trung gian dù chuyển động đã chạy, Task077). Có chạy hay không thì kiểm bằng sự kiện transition.
    await expectTransition(page, "width");
    for (let i = 1; i < closing.length; i++) expect(closing[i]).toBeLessThanOrEqual(closing[i - 1] + 0.5); // giảm đều, không nhảy ngược
    await expect(page.locator("#sql")).toHaveCount(0);
    expect(await w(page, "stage")).toBeGreaterThan(stageBefore + 200);

    await sample(page, "[data-zone=sql]");
    await flip(page, "en", L.en.sql);
    await page.waitForTimeout(500);
    const opening = await stopSample(page);
    console.log("sql opening widths", opening.map(Math.round).join(","));
    await expectTransition(page, "width");
    for (let i = 1; i < opening.length; i++) expect(opening[i]).toBeGreaterThanOrEqual(opening[i - 1] - 0.5);
    await expect(page.locator("#sql")).toBeVisible();
    expect(Math.abs((await w(page, "sql")) - before)).toBeLessThan(1);
    expect(Math.abs((await w(page, "stage")) - stageBefore)).toBeLessThan(1);

    // Terminal: chiều cao co giãn.
    const th = await page.locator("[data-zone=terminal]").evaluate((e) => e.getBoundingClientRect().height);
    await sample(page, "[data-zone=terminal]", "height");
    await flip(page, "en", L.en.term);
    await page.waitForTimeout(500);
    const t = await stopSample(page);
    await expectTransition(page, "height");
    await flip(page, "en", L.en.term);
    await page.waitForTimeout(500);
    expect(Math.abs((await page.locator("[data-zone=terminal]").evaluate((e) => e.getBoundingClientRect().height)) - th)).toBeLessThan(1);
  });

  test("AC4 bấm liên tục khi đang chuyển động: trạng thái cuối đúng, độ rộng về giá trị cũ", async ({ page }) => {
    await open(page, "en");
    const before = await w(page, "sql");
    await gear(page, "en").click();
    for (let i = 0; i < 7; i++) {
      await item(page, L.en.sql).click({ delay: 0 });
      await page.waitForTimeout(40);
    }
    // 7 lần bấm: cuối cùng tắt.
    await expect(item(page, L.en.sql)).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#sql")).toHaveCount(0);
    await item(page, L.en.sql).click();
    await expect(page.locator("#sql")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(async () => Math.abs((await w(page, "sql")) - before)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("AC4 kéo tay không có độ trễ transition, nhớ độ rộng sau khi tải lại", async ({ page }) => {
    await open(page, "en");
    const slot = page.locator("[data-zone=sql]");
    expect(await slot.evaluate((e) => getComputedStyle(e).transitionProperty)).not.toMatch(/width|all/);
    const sep = page.getByRole("separator").first();
    const box = (await sep.boundingBox())!;
    const w0 = await w(page, "sql");
    await page.mouse.move(box.x + 0.5, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 80.5, box.y + 200);
    // Ngay khung hình kế tiếp đã tới đích: không có đường cong làm trễ.
    expect(await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => r(document.querySelector("#sql")!.getBoundingClientRect().width))))).toBeCloseTo(w0 + 80, 0);
    expect(await slot.evaluate((e) => getComputedStyle(e).transitionProperty)).not.toMatch(/width|all/);
    await page.mouse.up();
    await page.reload();
    await editor(page).waitFor();
    expect(Math.abs((await w(page, "sql")) - (w0 + 80))).toBeLessThan(2);
  });

  test("AC4 giảm chuyển động thì đổi ngay, không animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "en");
    const slot = page.locator("[data-zone=sql]");
    await gear(page, "en").click();
    await item(page, L.en.sql).click();
    expect(await slot.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
    await expect.poll(() => slot.evaluate((e) => e.getBoundingClientRect().width)).toBe(0);
  });

  test("AC4 React Flow vẫn đủ nút sau khi cột đổi cỡ", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "en");
    await editor(page).click();
    await page.keyboard.type("CREATE TABLE a(id int primary key); CREATE TABLE b(id int primary key, a_id int references a(id));");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const nodes = page.locator(".react-flow__node:visible");
    await expect(nodes.first()).toBeVisible({ timeout: 90_000 });
    const n = await nodes.count();
    for (const z of [L.en.sql, L.en.findings, L.en.sql, L.en.findings]) {
      await flip(page, "en", z);
      await page.waitForTimeout(450);
      await expect(nodes).toHaveCount(n);
      const stage = (await page.locator("#stage").boundingBox())!;
      for (let i = 0; i < n; i++) {
        const b = (await nodes.nth(i).boundingBox())!;
        expect(b.x + b.width, `nút ${i} nằm trong stage`).toBeGreaterThan(stage.x);
        expect(b.x, `nút ${i} nằm trong stage`).toBeLessThan(stage.x + stage.width);
      }
    }
    await page.screenshot({ path: `${OUT}sau-1440-en-stage-sau-doi-co.png` });
  });

  test("ca biên: tắt hết cột, mở menu rồi đổi ngôn ngữ", async ({ page }) => {
    await open(page, "en");
    await flip(page, "en", L.en.sql);
    await flip(page, "en", L.en.stage);
    await flip(page, "en", L.en.findings);
    await expect(page.locator("#terminal")).toBeVisible();
    await expect(page.locator("#sql, #stage, #findings")).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}sau-1440-en-chi-con-terminal.png` });
    await gear(page, "en").click();
    await expect(item(page, L.en.term)).toBeDisabled();
    await expect(page.getByRole("note")).toContainText("cannot be hidden");
    await page.screenshot({ path: `${OUT}sau-1440-en-menu-vung-cuoi.png`, clip: { x: 1000, y: 0, width: 440, height: 300 } });
    // Đổi ngôn ngữ khi menu đang mở: bấm EN/VI ngoài menu.
    // Menu modal: lần bấm đầu đóng menu, lần hai mới đổi ngôn ngữ.
    await page.getByRole("button", { name: "Tiếng Việt" }).click({ force: true });
    if (/\/en/.test(page.url())) await page.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(page).toHaveURL(/\/vi(\/lab)?$/);
    await expect(page.locator("#terminal:visible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tiếng Việt" })).toBeVisible();
    await page.keyboard.press("Escape");
    await gear(page, "vi").click();
    await expect(item(page, L.vi.term)).toBeDisabled();
    await expect(item(page, L.vi.sql)).toHaveAttribute("aria-checked", "false");
    await page.screenshot({ path: `${OUT}sau-1440-vi-menu-sau-doi-ngon-ngu.png`, clip: { x: 1000, y: 0, width: 440, height: 300 } });
  });

  test("reviewer: chỉ hover bánh răng thì không quay; Escape đóng menu quay về 0 một mạch", async ({ page }) => {
    await open(page, "en");
    await gear(page, "en").hover();
    await expect(page.locator("[data-slot=tooltip-content][data-open]")).toBeVisible();
    expect(await angle(page)).toBe(0);
    await gear(page, "en").click();
    await expect.poll(() => angle(page)).toBe(90);
    await page.evaluate(() => ((window as unknown as { seq: number[] }).seq = []));
    const done = page.evaluate(
      () =>
        new Promise<number[]>((res) => {
          const el = document.querySelector("button[aria-haspopup='menu'] svg")!;
          const out: number[] = [];
          const tick = () => {
            const v = getComputedStyle(el).rotate;
            out.push(v === "none" ? 0 : Math.round(parseFloat(v)));
            if (out.length < 60) requestAnimationFrame(tick);
            else res(out);
          };
          tick();
        }),
    );
    await page.keyboard.press("Escape");
    const seq = await done;
    for (let i = 1; i < seq.length; i++) expect(seq[i], `quay ngược lên: ${seq}`).toBeLessThanOrEqual(seq[i - 1]);
    expect(seq.at(-1)).toBe(0);
  });

  test("reviewer: cột đã lưu to hơn cửa sổ thì được kẹp lại, không tràn, mở rộng lại về cỡ đã lưu", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sqllens.layout", '{"open":{"sql":true,"stage":true,"findings":true,"terminal":true},"size":{"sql":560,"findings":560,"terminal":180}}'));
    await page.setViewportSize({ width: 1000, height: 900 });
    await open(page, "en");
    const r = async () => page.evaluate(() => ["sql", "stage", "findings"].map((z) => document.querySelector<HTMLElement>(`[data-zone=${z}]`)!.getBoundingClientRect()));
    let [a, b, c] = await r();
    expect(b.width).toBeGreaterThanOrEqual(158);
    expect(c.right).toBeLessThanOrEqual(1001);
    expect(a.width).toBeGreaterThanOrEqual(220);
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect.poll(async () => Math.round((await r())[0].width)).toBe(560);
    [a, b, c] = await r();
    expect(Math.round(c.width)).toBe(560);
  });

  test("ca biên: đổi cỡ cửa sổ qua mốc 900 px giữ trạng thái cột", async ({ page }) => {
    await open(page, "en");
    await flip(page, "en", L.en.findings);
    await expect(page.locator("#findings")).toHaveCount(0);
    await page.setViewportSize({ width: 899, height: 800 });
    await expect(page.getByRole("tablist", { name: "Work panels" })).toBeVisible();
    await expect(gear(page, "en")).toBeHidden();
    await page.setViewportSize({ width: 901, height: 800 });
    await expect(gear(page, "en")).toBeVisible();
    await expect(page.locator("#findings")).toHaveCount(0);
    await expect(page.locator("#sql")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  for (const l of ["vi", "en"] as const) {
    test(`khung hình đóng cột ${l}: chụp nhiều khung ở tốc độ chậm`, async ({ page }) => {
      test.setTimeout(120_000);
      await open(page, l);
      await editor(page).click();
      await page.keyboard.type("SELECT 1;");
      // Dừng transition width/height ngay khi chúng bắt đầu, rồi tua tới từng mức tiến độ để chụp.
      await page.evaluate(() => {
        const w = window as unknown as { __anims: Animation[] };
        w.__anims = [];
        document.addEventListener("transitionrun", (e) => {
          const ev = e as TransitionEvent;
          if (!/width|height/.test(ev.propertyName)) return;
          (ev.target as Element).getAnimations().forEach((a) => {
            if ((a as CSSTransition).transitionProperty !== ev.propertyName) return;
            a.pause();
            w.__anims.push(a);
          });
        });
      });
      await gear(page, l).click();
      await page.screenshot({ path: `${OUT}sau-1440-${l}-anim-menu-0.png`, clip: { x: 1000, y: 0, width: 440, height: 300 } });
      await item(page, L[l].sql).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __anims: Animation[] }).__anims.length)).toBeGreaterThan(0);
      for (const [i, f] of [0.1, 0.25, 0.45, 0.7, 0.9].entries()) {
        await page.evaluate((f) => (window as unknown as { __anims: Animation[] }).__anims.forEach((a) => (a.currentTime = f * 260)), f);
        await page.waitForTimeout(80);
        await page.screenshot({ path: `${OUT}sau-1440-${l}-anim-dong-sql-${i + 1}.png` });
      }
      await page.evaluate(() => (window as unknown as { __anims: Animation[] }).__anims.forEach((a) => a.play()));
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape");
    });
  }
});

test.describe("điện thoại 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const l of ["vi", "en"] as const) {
    test(`${l}: vẫn là bốn tab, không có bánh răng tràn màn hình, ô SQL focus có viền`, async ({ page }) => {
      await page.goto(`/${l}/lab`);
      const tab = page.getByRole("tab", { name: "SQL", exact: true });
      await tab.click();
      await editor(page).waitFor();
      await expect(gear(page, l)).toBeHidden();
      await editor(page).click();
      await page.keyboard.type("SELECT 1;");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${OUT}sau-390-${l}-sql-focus.png` });
      await crop(page, `${OUT}sau-390-${l}-sql-focus-crop.png`);
      // Chạm vào nút: tooltip không mở che thao tác.
      await page.getByRole("button", { name: L[l].run, exact: true }).tap();
      await expect(page.locator("[data-slot=tooltip-content]")).toHaveCount(0);
    });
  }
});
