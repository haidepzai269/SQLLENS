import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { LabWorkspace } from "@/modules/lab/lab-workspace";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // useSearchParams (engine trên URL) cần Suspense khi prerender.
  return (
    <Suspense fallback={<Skeleton className="m-[var(--edge)] flex-1" />}>
      <LabWorkspace />
    </Suspense>
  );
}
