import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { isBlockedE2eRoute } from "@/lib/e2e-route-guard";

const intl = createMiddleware(routing);

// Chưa chọn ngôn ngữ thì luôn về vi, không đoán theo Accept-Language.
export default function proxy(request: NextRequest) {
  if (isBlockedE2eRoute(request.nextUrl.pathname, process.env.VERCEL_ENV)) return new NextResponse(null, { status: 404 });
  if (!request.cookies.has("NEXT_LOCALE")) request.headers.delete("accept-language");
  return intl(request);
}

// Không dùng `\.`: Next đọc matcher bằng phân tích tĩnh và làm rơi dấu gạch chéo, khiến `.*..*` loại mọi đường dẫn từ 2 ký tự (đo ở .next/server/functions-config-manifest.json).
export const config = { matcher: ["/((?!api|_next|_vercel|.*[.].*).*)"] };
