import { getTranslations, setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  return (
    <main className="flex flex-col gap-4 p-4">
      <LanguageSwitcher />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("description")}</p>
    </main>
  );
}
