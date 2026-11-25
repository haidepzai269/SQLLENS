import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { P2pHarness } from "./harness";

// Route thử cho Playwright (Task166): kiểm broadcast kết quả SQL P2P qua kênh control,
// tự động trả Baton sau timeout và NatWarningBanner. Bị chặn ở production qua isBlockedE2eRoute.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <Suspense>
      <P2pHarness />
    </Suspense>
  );
}
