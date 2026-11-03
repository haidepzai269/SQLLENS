import { setRequestLocale } from "next-intl/server";
import { Harness } from "./harness";

// Trang kiểm thử cho Playwright (Task019): chỉ đưa createPostgresAdapter ra window, không có giao diện.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <Harness />;
}
