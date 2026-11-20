import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShareView } from "@/modules/share/share-view";
import "@/modules/share/share.css";

/**
 * Route `/share` chỉ là vỏ server: nội dung nằm trong fragment nên không bao giờ
 * được server đọc. Mọi trạng thái (kể cả "đang giải mã") do ShareView dựng ở máy khách.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "share" });
  return {
    title: t("view.metaTitle"),
    // Link chia sẻ là bản nháp của một người, không phải trang công khai cần index.
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ShareView />;
}
