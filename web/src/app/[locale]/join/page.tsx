import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { JoinRoomPage } from "@/modules/room/join-room-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "room.join" });
  // Link mời là bí mật của một phòng: không index, không theo liên kết.
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // `useSearchParams` cần Suspense khi prerender.
  return (
    <Suspense fallback={null}>
      <JoinRoomPage />
    </Suspense>
  );
}
