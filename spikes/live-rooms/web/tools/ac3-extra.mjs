// AC3 phụ — đo xem model B-Tree có chứa "hidden" (phần viewer không thấy) hay không,
// và đo khối lượng của phần THẬT SỰ cần gửi cho viewer.
//
// Chạy: node tools/ac3-extra.mjs
import { launch, save, waitFor, median, WEB, sleep } from "./lib.mjs";

const RUNS = Number(process.env.RUNS ?? 3);
const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${WEB}/ac3`, { waitUntil: "domcontentloaded" });
  const r = await waitFor(page, "__ac3detail");
  await browser.close();
  runs.push({ run: i, ...r });
  console.log(
    `lần ${i}: main nodes=${r.main.nodes} hidden=${JSON.stringify(r.main.hidden)} keysShown=${r.main.keysShown}/${r.main.totalKeys} pathPages=${JSON.stringify(r.main.pathPages)}`,
  );
  await sleep(500);
}

save("ac3_extra.json", {
  runs,
  median: {
    mainNodes: median(runs.map((r) => r.main.nodes)),
    mainHiddenTotal: median(runs.map((r) => r.main.hidden.reduce((a, h) => a + h.count, 0))),
    mainKeysShown: median(runs.map((r) => r.main.keysShown)),
    mainTotalKeys: median(runs.map((r) => r.main.totalKeys)),
    pkNodes: median(runs.map((r) => r.pk.nodes)),
    pkHiddenTotal: median(runs.map((r) => r.pk.hidden.reduce((a, h) => a + h.count, 0))),
    pkKeysShown: median(runs.map((r) => r.pk.keysShown)),
    pkTotalKeys: median(runs.map((r) => r.pk.totalKeys)),
  },
});
console.log(JSON.stringify(runs[0], null, 2));
