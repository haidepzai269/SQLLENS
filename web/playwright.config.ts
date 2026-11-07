import { defineConfig } from "@playwright/test";

// Các task chạy song song đặt E2E_PORT khác nhau để không đụng cổng.
const port = process.env.E2E_PORT ?? "3100";

// E2E chạy trên bản build (next start), không chạy trên next dev. Chạy `npm run build` trước.
export default defineConfig({
  testDir: "./e2e",
  // CI cho chạy lại một lần để một lần chập chờn không chặn, nhưng reporter "flaky" liệt kê rõ test nào phải chạy lại để còn sửa.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["./e2e/flaky-reporter.ts"]] : "list",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}/vi`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
