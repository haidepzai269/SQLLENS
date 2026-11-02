import { setRequestLocale } from "next-intl/server";
import { LabClient } from "@/modules/lab/lab-client";

export default async function LabPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LabClient />;
}
