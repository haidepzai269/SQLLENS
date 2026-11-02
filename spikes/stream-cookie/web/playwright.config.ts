import { defineConfig } from "@playwright/test";

// Cần server Go chạy ở :18140 trước (xem ket_qua.md). Next chạy bản build ở :3140.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3140" },
  webServer: { command: "npm run start -- -p 3140", url: "http://localhost:3140", reuseExistingServer: false, timeout: 60_000 },
});
