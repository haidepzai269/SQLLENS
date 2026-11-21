import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vite không phân giải được `next/navigation` (gói con của Next) khi nó được import từ bên trong
// `node_modules/next-intl/dist/...`: bộ phân giải của Vite đòi đúng tên tệp, không tự thêm `.js`
// như Node. Trỏ thẳng vào tệp, và nạp nội tuyến `next-intl` để alias có hiệu lực bên trong gói.
const nextNavigation = fileURLToPath(new URL("./node_modules/next/navigation.js", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "next/navigation": nextNavigation,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    maxWorkers: 2,
    server: { deps: { inline: ["next-intl"] } },
  },
});
