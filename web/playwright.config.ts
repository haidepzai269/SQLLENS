import { defineConfig } from "@playwright/test";

// E2E chạy trên bản build (next start), không chạy trên next dev. Chạy `npm run build` trước.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100/vi",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
