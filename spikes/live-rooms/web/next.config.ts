import type { NextConfig } from "next";

/**
 * Spike Task159.
 *
 * `compress: false` là điều kiện để SSE sống qua `rewrites` (Task014). AC4 kiểm lại
 * điều này trên Next 16.4.4. Đổi bằng env để đo được cả hai phía.
 */
const nextConfig: NextConfig = {
  compress: process.env.NEXT_COMPRESS === "1",
  async rewrites() {
    const origin = process.env.API_ORIGIN ?? "http://localhost:18160";
    return [{ source: "/api/:path*", destination: `${origin}/:path*` }];
  },
};

export default nextConfig;
