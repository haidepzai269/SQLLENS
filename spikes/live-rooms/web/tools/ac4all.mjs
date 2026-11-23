// Chạy AC4 đủ: sse và poll, mỗi mode 3 lần, 30 viewer, 10 phút.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HERE } from "./lib.mjs";

const modes = process.argv.slice(2);
const list = modes.length ? modes : ["sse", "poll"];
for (const mode of list) {
  console.log(`\n===== AC4 ${mode} =====`);
  const r = spawnSync(process.execPath, [join(HERE, "ac4.mjs"), mode, "30", "10"], {
    env: { ...process.env, RUNS: process.env.RUNS ?? "3" },
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`AC4 ${mode} thất bại`);
    process.exitCode = 1;
  }
}
