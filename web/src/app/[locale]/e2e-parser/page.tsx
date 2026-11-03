import { setRequestLocale } from "next-intl/server";
import { Harness } from "./harness";

// Trang kiểm thử cho Playwright (Task028): chỉ đưa parseSql ra window, không có giao diện. Chặn ở SP013.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <Harness />;
}
