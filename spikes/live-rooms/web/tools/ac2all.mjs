// Chạy toàn bộ AC2: 4 cấu hình (sse|poll) × (có phát|đứng yên), mỗi cấu hình 3 lần.
// Gọi tuần tự để các lần đo không tranh CPU của nhau.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HERE } from "./lib.mjs";

const configs = [
  { mode: "sse", publish: "1" },
  { mode: "sse", publish: "0" },
  { mode: "poll", publish: "1" },
  { mode: "poll", publish: "0" },
];

for (const c of configs) {
  const env = { ...process.env, PUBLISH: c.publish, RUNS: process.env.RUNS ?? "3" };
  console.log(`\n=== ${c.mode} publish=${c.publish} ===`);
  const r = spawnSync(process.execPath, [join(HERE, "ac2.mjs"), c.mode], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`thất bại: ${c.mode}/${c.publish}`);
    process.exitCode = 1;
  }
}
