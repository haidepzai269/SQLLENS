import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { ZonePlaceholder } from "@/components/shell/zone-placeholder";
import { ZONES } from "@/components/shell/layout-state";

// Các trang sau thay từng ZonePlaceholder bằng nội dung thật, không sửa WorkspaceLayout.
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("shell");
  const zones = Object.fromEntries(
    ZONES.map((z) => [z, <ZonePlaceholder key={z} title={t(`tab.${z}`)} hint={t(`placeholder.${z}`)} />]),
  ) as React.ComponentProps<typeof WorkspaceLayout>;
  return <WorkspaceLayout {...zones} />;
}
