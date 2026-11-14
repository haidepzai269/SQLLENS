"use client";

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
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

/**
 * Đồng bộ Theme và Contrast Boost lên DOM root (document.documentElement).
 * Hỗ trợ theme:
 * - "dark": thêm class `dark`, bỏ class `light`
 * - "light": thêm class `light`, bỏ class `dark`
 * - "auto": lắng nghe prefers-color-scheme của hệ điều hành
 * Contrast boost:
 * - true: thêm class `contrast-high` và attribute data-contrast="boost"
 * - false: bỏ class `contrast-high` và bỏ attribute data-contrast
 */
export function applyThemeAndContrastToDOM(
  theme: "dark" | "light" | "auto",
  contrastBoost: boolean
): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;

  const applyTheme = (isDark: boolean) => {
    if (isDark) {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
  };

  let mediaQuery: MediaQueryList | null = null;
  let listener: ((e: MediaQueryListEvent) => void) | null = null;

  if (theme === "dark") {
    applyTheme(true);
  } else if (theme === "light") {
    applyTheme(false);
  } else if (theme === "auto") {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);
      listener = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", listener);
      } else if (typeof (mediaQuery as unknown as { addListener?: (l: unknown) => void }).addListener === "function") {
        (mediaQuery as unknown as { addListener: (l: unknown) => void }).addListener(listener);
      }
    } else {
      applyTheme(true);
    }
  }

  if (contrastBoost) {
    root.classList.add("contrast-high");
    root.setAttribute("data-contrast", "boost");
  } else {
    root.classList.remove("contrast-high");
    root.removeAttribute("data-contrast");
  }

  return () => {
    if (mediaQuery && listener) {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", listener);
      } else if (typeof (mediaQuery as unknown as { removeListener?: (l: unknown) => void }).removeListener === "function") {
        (mediaQuery as unknown as { removeListener: (l: unknown) => void }).removeListener(listener);
      }
    }
  };
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

let memoryFallback: string | null = null;

export function _resetMemoryFallbackForTest(): void {
  memoryFallback = null;
}

function getSnapshot(): string {
  if (typeof window === "undefined") return "";
  if (memoryFallback !== null) return memoryFallback;
  try {
    const val = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return val ?? "";
  } catch {
    return "";
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
          memoryFallback = null;
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
        memoryFallback = null;
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

  useEffect(() => {
    return applyThemeAndContrastToDOM(settings.theme, settings.contrastBoost);
  }, [settings.theme, settings.contrastBoost]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
