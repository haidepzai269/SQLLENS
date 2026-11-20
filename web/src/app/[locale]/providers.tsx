"use client";

import React from "react";
import { SettingsProvider } from "@/contexts/settings-context";
import { ShellProvider } from "@/components/shell/shell-provider";
import { Toaster } from "@/components/ui/sonner";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SettingsProvider>
      <ShellProvider>{children}</ShellProvider>
      {/* Thông báo ngắn (tải file, fork snapshot) phải sống qua điều hướng giữa các route. */}
      <Toaster position="top-center" />
    </SettingsProvider>
  );
}

export default Providers;
