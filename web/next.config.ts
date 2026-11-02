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
  rewrites: async () => [{ source: "/api/:path*", destination: `${apiOrigin()}/:path*` }],
  // request.ts đọc messages/ bằng fs lúc chạy, nên phải kèm vào bản deploy.
  outputFileTracingIncludes: { "/**": ["./messages/**/*.json"] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
