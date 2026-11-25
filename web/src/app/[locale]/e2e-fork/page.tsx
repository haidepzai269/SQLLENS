import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ForkHarness } from "./harness";

// Route thử cho Playwright (Task167): kiểm luồng ForkDialog và phòng fork trong IndexedDB thật.
// Bị chặn ở production qua isBlockedE2eRoute trong web/src/proxy.ts.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <Suspense>
      <ForkHarness />
    </Suspense>
  );
}
