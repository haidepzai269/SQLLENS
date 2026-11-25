import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ArenaHarness } from "./harness";

// Route thử cho Playwright (Task169): kiểm thử đồ thị Wait-For Graph và đồng bộ Host -> Viewer.
// Bị chặn ở production trong `web/src/proxy.ts` cùng nhóm `e2e-*`.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return (
    <Suspense fallback={null}>
      <ArenaHarness />
    </Suspense>
  );
}
