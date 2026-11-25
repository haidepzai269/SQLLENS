import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Chỉ phía server. Build production thiếu hoặc sai thì dừng, tránh deploy proxy trỏ vào "undefined".
function apiOrigin(): string {
  const v = process.env.API_ORIGIN?.trim();
  if (!v) {
    if (process.argv.includes("build")) {
      throw new Error("API_ORIGIN is required for build: set it to the Gin origin, e.g. https://sqllens-api.onrender.com");
    }
    return "http://localhost:8080"; // dev/test cục bộ
  }
  if (!/^https?:\/\/[^/\s?#]+$/.test(v.replace(/\/+$/, ""))) {
    throw new Error(`API_ORIGIN must be an http(s) origin without a path, got "${v}"`);
  }
  return v.replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  // Snapshot nằm trong fragment nên trình duyệt không gửi nó đi; referrer của trang share
  // vẫn có thể mang theo URL cho bên thứ ba (ảnh, font). Cắt referrer để link không rò rỉ.
  // `/join` cũng vậy: token mời nằm trong query và sống 24 giờ, nên referrer không được mang nó đi.
  headers: async () => [
    {
      source: "/:locale(vi|en)/share",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/share",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: "/:locale(vi|en)/join",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
  ],
  // /lab cũ về màn hình chính; Next giữ nguyên query khi chuyển hướng.
  redirects: async () => [{ source: "/:locale(vi|en)/lab", destination: "/:locale", permanent: false }],
  rewrites: async () => [
    // Route cloud của Gin đăng ký CÓ tiền tố /api, các route Gin khác thì không. Rule chung bên
    // dưới cắt /api nên phải có rule riêng này đứng trước: Next áp rule khớp đầu tiên, đổi thứ
    // tự là cloud rơi vào NoRoute 404 và trần body 3MB của route cloud mất tác dụng.
    // shortcut: hai quy ước tiền tố song song, gộp về một khi được đổi tên route Gin.
    { source: "/api/v1/cloud/:path*", destination: `${apiOrigin()}/api/v1/cloud/:path*` },
    { source: "/api/:path*", destination: `${apiOrigin()}/:path*` },
  ],
  // request.ts đọc messages/ bằng fs lúc chạy, nên phải kèm vào bản deploy.
  outputFileTracingIncludes: { "/**": ["./messages/**/*.json"] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.resolve(process.cwd(), "../../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      // @sqlite.org/sqlite-wasm tạo worker OPFS từ URL động, Turbopack dừng build ở đó ("Can't resolve <dynamic>").
      // Ứng dụng dùng DB trong bộ nhớ, không dùng OPFS, nên worker đó được thay bằng module rỗng.
      "**/@sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs": {
        loaders: [path.resolve(process.cwd(), "scripts/turbopack-sqlite-opfs-stub.cjs")],
        as: "*.mjs",
      },
    },
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
