import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppFrame } from "@/components/shell/app-frame";
import { ShellProvider } from "@/components/shell/shell-provider";
import { routing } from "@/i18n/routing";
import "../globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin", "vietnamese"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin", "vietnamese"] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common" });
  return { title: t("appName"), description: t("appName") };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale} className={`dark ${publicSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="relative flex h-dvh flex-col overflow-hidden">
        <NextIntlClientProvider>
          <ShellProvider>
            <AppFrame>{children}</AppFrame>
          </ShellProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
