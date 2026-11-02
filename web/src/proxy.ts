import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intl = createMiddleware(routing);

// Chưa chọn ngôn ngữ thì luôn về vi, không đoán theo Accept-Language.
export default function proxy(request: NextRequest) {
  if (!request.cookies.has("NEXT_LOCALE")) request.headers.delete("accept-language");
  return intl(request);
}

export const config = { matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"] };
