import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { BatonHarness } from "./harness";

// Route thử cho Playwright (Task165): dựng LabWorkspace gắn baton-store để kiểm
// nút Run, tooltip và BatonRequestToast trên 2 browser context thật. Bị chặn ở production qua isBlockedE2eRoute.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <Suspense>
      <BatonHarness />
    </Suspense>
  );
}
