import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Task159 — cổng đo Live Rooms",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0, padding: 24, background: "#0b0d10", color: "#e6e8eb" }}>
        {children}
      </body>
    </html>
  );
}
