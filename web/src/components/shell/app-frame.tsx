"use client";

import { usePathname } from "@/i18n/navigation";
import { AppHeader } from "./app-header";
import { isBareRoute } from "./bare-routes";

// Route trong BARE_ROUTES không có khung ứng dụng, cuộn bằng cửa sổ (globals.css đọc data-bare).
export function AppFrame({ children }: { children: React.ReactNode }) {
  if (isBareRoute(usePathname())) return <div data-bare>{children}</div>;
  return (
    <>
      <AppHeader />
      <div id="content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
    </>
  );
}
