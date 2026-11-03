import { defineConfig } from "@playwright/test";

// Các task chạy song song đặt E2E_PORT khác nhau để không đụng cổng.
const port = process.env.E2E_PORT ?? "3100";

// E2E chạy trên bản build (next start), không chạy trên next dev. Chạy `npm run build` trước.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}/vi`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
