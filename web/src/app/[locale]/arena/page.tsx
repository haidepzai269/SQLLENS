import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { ArenaPageClient } from "./arena-page-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "arena" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: { languages: { vi: "/vi/arena", en: "/en/arena" } },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // `useSearchParams` cần Suspense khi prerender tĩnh ở Next.js 16.
  return (
    <Suspense fallback={null}>
      <ArenaPageClient />
    </Suspense>
  );
}
