// AC3 — byte của Plan và B-Tree 100k dòng. 3 lần, trung vị.
// Toàn bộ số byte do chính trang đo tính trên `BTreeModel` thật mà `readBTree` trả về.
import { launch, save, waitFor, median, WEB, sleep } from "./lib.mjs";

const runs = [];
const N = Number(process.env.RUNS ?? 3);

for (let i = 1; i <= N; i++) {
  const browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`${WEB}/ac3`, { waitUntil: "domcontentloaded" });
  const r = await waitFor(page, "__ac3");
  await browser.close();

  if (r.error) {
    console.error(`lần ${i}: LỖI ${r.error}`);
    process.exitCode = 1;
    continue;
  }
  runs.push({ run: i, plan: r.plan, btrees: r.btrees, result: r.result, errors });
  const main = r.btrees["orders_customer_id_idx"];
  console.log(
    `lần ${i}: idx json=${main.jsonBytes}B gzip=${main.gzipBytes}B payload=${main.sharePayloadBytes}B height=${main.height} pages=${main.totalPages} nodes=${main.nodesRead} readMs=${main.readMs.toFixed(1)} | plan json=${r.plan.normalizedJsonBytes}B gzip=${r.plan.normalizedGzipBytes}B nodes=${r.plan.nodeCount}`,
  );
  await sleep(500);
}

const pick = (f) => runs.map(f);
const main = (r) => r.btrees["orders_customer_id_idx"];
const pk = (r) => r.btrees["orders_pkey"];

const summary = {
  runs,
  median: {
    planNormalizedJsonBytes: median(pick((r) => r.plan.normalizedJsonBytes)),
    planNormalizedGzipBytes: median(pick((r) => r.plan.normalizedGzipBytes)),
    planNormalizedPayloadBytes: median(pick((r) => r.plan.normalizedPayloadBytes)),
    planRawJsonBytes: median(pick((r) => r.plan.rawJsonBytes)),
    planRawGzipBytes: median(pick((r) => r.plan.rawGzipBytes)),
    planNodeCount: median(pick((r) => r.plan.nodeCount)),

    mainJsonBytes: median(pick((r) => main(r).jsonBytes)),
    mainJsonPathBytes: median(pick((r) => main(r).jsonPathBytes)),
    mainGzipBytes: median(pick((r) => main(r).gzipBytes)),
    mainGzipPathBytes: median(pick((r) => main(r).gzipPathBytes)),
    mainSharePayloadBytes: median(pick((r) => main(r).sharePayloadBytes)),
    mainSharePayloadWithPathBytes: median(pick((r) => main(r).sharePayloadWithPathBytes)),
    mainHeight: median(pick((r) => main(r).height)),
    mainTotalPages: median(pick((r) => main(r).totalPages)),
    mainIndexBytes: median(pick((r) => main(r).indexBytes)),
    mainNodesRead: median(pick((r) => main(r).nodesRead)),
    mainKeysInModel: median(pick((r) => main(r).keysInModel)),
    mainTotalKeys: median(pick((r) => main(r).totalKeysInModel)),
    mainReadMs: median(pick((r) => main(r).readMs)),

    pkJsonBytes: median(pick((r) => pk(r).jsonBytes)),
    pkGzipBytes: median(pick((r) => pk(r).gzipBytes)),
    pkSharePayloadBytes: median(pick((r) => pk(r).sharePayloadBytes)),
    pkHeight: median(pick((r) => pk(r).height)),
    pkTotalPages: median(pick((r) => pk(r).totalPages)),
    pkIndexBytes: median(pick((r) => pk(r).indexBytes)),
    pkNodesRead: median(pick((r) => pk(r).nodesRead)),
    pkTotalKeys: median(pick((r) => pk(r).totalKeysInModel)),
    pkReadMs: median(pick((r) => pk(r).readMs)),

    resultBytes: median(pick((r) => r.result.bytes)),
  },
};
save("ac3.json", summary);
console.log(JSON.stringify(summary.median, null, 2));
