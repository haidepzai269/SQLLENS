import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium" },
  webServer: { command: "node build.mjs && node serve.mjs", url: "http://127.0.0.1:4173/", reuseExistingServer: false, timeout: 60_000 },
});
