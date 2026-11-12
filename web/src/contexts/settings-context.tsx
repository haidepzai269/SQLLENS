"use client";

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";

export interface SettingsState {
  lineNumbers: boolean;           // Mặc định: true
  lineWrapping: boolean;          // Mặc định: true
  highlightActiveLine: boolean;   // Mặc định: true
  fontSize: 13 | 14 | 16;         // Mặc định: 14
  theme: "dark" | "light" | "auto"; // Mặc định: "dark"
  contrastBoost: boolean;         // Mặc định: false
  ghostTextEnabled: boolean;      // Mặc định: true (BẬT)
  dropdownAutocomplete: boolean;  // Mặc định: false (TẮT)
  aiCopilotEnabled: boolean;      // Mặc định: false (TẮT)
}

export const SETTINGS_STORAGE_KEY = "sqllens_settings_v1";

export const DEFAULT_SETTINGS: SettingsState = {
  lineNumbers: true,
  lineWrapping: true,
  highlightActiveLine: true,
  fontSize: 14,
  theme: "dark",
  contrastBoost: false,
  ghostTextEnabled: true,
  dropdownAutocomplete: false,
  aiCopilotEnabled: false,
};

function isValidFontSize(val: unknown): val is 13 | 14 | 16 {
  return val === 13 || val === 14 || val === 16;
}

function isValidTheme(val: unknown): val is "dark" | "light" | "auto" {
  return val === "dark" || val === "light" || val === "auto";
}

export function sanitizeSettings(raw: unknown): SettingsState {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const r = raw as Record<string, unknown>;

  return {
    lineNumbers: typeof r.lineNumbers === "boolean" ? r.lineNumbers : DEFAULT_SETTINGS.lineNumbers,
    lineWrapping: typeof r.lineWrapping === "boolean" ? r.lineWrapping : DEFAULT_SETTINGS.lineWrapping,
    highlightActiveLine: typeof r.highlightActiveLine === "boolean" ? r.highlightActiveLine : DEFAULT_SETTINGS.highlightActiveLine,
    fontSize: isValidFontSize(r.fontSize) ? r.fontSize : DEFAULT_SETTINGS.fontSize,
    theme: isValidTheme(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    contrastBoost: typeof r.contrastBoost === "boolean" ? r.contrastBoost : DEFAULT_SETTINGS.contrastBoost,
    ghostTextEnabled: typeof r.ghostTextEnabled === "boolean" ? r.ghostTextEnabled : DEFAULT_SETTINGS.ghostTextEnabled,
    dropdownAutocomplete: typeof r.dropdownAutocomplete === "boolean" ? r.dropdownAutocomplete : DEFAULT_SETTINGS.dropdownAutocomplete,
    aiCopilotEnabled: typeof r.aiCopilotEnabled === "boolean" ? r.aiCopilotEnabled : DEFAULT_SETTINGS.aiCopilotEnabled,
  };
}

export interface SettingsContextValue {
  settings: SettingsState;
  updateSettings: (partial: Partial<SettingsState>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

let memoryFallback: string | null = null;

function getSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    const val = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return val ?? memoryFallback ?? "";
  } catch {
    return memoryFallback ?? "";
  }
}

function getServerSnapshot(): string {
  return "";
}

const SETTINGS_EVENT = "sqllens:settings-change";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(SETTINGS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SETTINGS_EVENT, callback);
  };
}

export interface SettingsProviderProps {
  children: React.ReactNode;
  initialSettings?: Partial<SettingsState>;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children, initialSettings }) => {
  const rawStored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const settings = useMemo(() => {
    if (!rawStored) {
      return {
        ...DEFAULT_SETTINGS,
        ...(initialSettings ? sanitizeSettings(initialSettings) : {}),
      };
    }
    try {
      const parsed = JSON.parse(rawStored);
      return sanitizeSettings(parsed);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }, [rawStored, initialSettings]);

  const updateSettings = useCallback(
    (partial: Partial<SettingsState>) => {
      const next = sanitizeSettings({
        ...settings,
        ...partial,
      });
      const str = JSON.stringify(next);

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(SETTINGS_STORAGE_KEY, str);
        } catch {
          memoryFallback = str;
        }
        window.dispatchEvent(new Event(SETTINGS_EVENT));
      } else {
        memoryFallback = str;
      }
    },
    [settings]
  );

  const resetSettings = useCallback(() => {
    const str = JSON.stringify(DEFAULT_SETTINGS);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, str);
      } catch {
        memoryFallback = str;
      }
      window.dispatchEvent(new Event(SETTINGS_EVENT));
    } else {
      memoryFallback = str;
    }
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      resetSettings,
    }),
    [settings, updateSettings, resetSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
