// Chụp ảnh khung ở hai ngôn ngữ, hai chiều rộng. Chạy: cd web && node ../_bmad-output/SP001/STR002/Task006/chup.mjs
import { chromium } from "file:///C:/SQLLens/.worktrees/Task006/web/node_modules/@playwright/test/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const out = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]])
  for (const l of ["vi", "en"]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(`http://localhost:3101/${l}?engine=mysql`);
    await p.waitForTimeout(800);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log(l, w, "cuộn ngang:", over);
    await p.screenshot({ path: path.join(out, `anh_${l}_${w}.png`) });
    await p.close();
  }
await b.close();
