"use client";

import React from "react";
import { SettingsProvider } from "@/contexts/settings-context";
import { ShellProvider } from "@/components/shell/shell-provider";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SettingsProvider>
      <ShellProvider>{children}</ShellProvider>
    </SettingsProvider>
  );
}

export default Providers;
