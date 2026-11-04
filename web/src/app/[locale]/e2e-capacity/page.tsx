import { setRequestLocale } from "next-intl/server";
import { Harness } from "./harness";

// Route thử cho Playwright (Task057). Phải chặn ở SP013 trước khi phát hành.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <Harness />;
}
