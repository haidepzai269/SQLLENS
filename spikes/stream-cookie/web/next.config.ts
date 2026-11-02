import type { NextConfig } from "next";

const API = process.env.API_ORIGIN ?? "http://localhost:18140";

const config: NextConfig = {
  // next start nén gzip và gom stream. Tắt để stream chảy; để nginx/Vercel tự nén.
  compress: process.env.NEXT_COMPRESS === "1",
  rewrites: async () => [{ source: "/api/:path*", destination: `${API}/:path*` }],
};
export default config;
