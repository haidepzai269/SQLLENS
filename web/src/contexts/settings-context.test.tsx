import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import {
  SettingsProvider,
  useSettings,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  sanitizeSettings,
} from "./settings-context";

// Component helper để đọc và thao tác context trong test
const TestConsumer = () => {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <div>
      <span data-testid="lineNumbers">{String(settings.lineNumbers)}</span>
      <span data-testid="lineWrapping">{String(settings.lineWrapping)}</span>
      <span data-testid="highlightActiveLine">{String(settings.highlightActiveLine)}</span>
      <span data-testid="fontSize">{settings.fontSize}</span>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="contrastBoost">{String(settings.contrastBoost)}</span>
      <span data-testid="ghostTextEnabled">{String(settings.ghostTextEnabled)}</span>
      <span data-testid="dropdownAutocomplete">{String(settings.dropdownAutocomplete)}</span>
      <span data-testid="aiCopilotEnabled">{String(settings.aiCopilotEnabled)}</span>

      <button
        type="button"
        data-testid="toggleGhost"
        onClick={() => updateSettings({ ghostTextEnabled: !settings.ghostTextEnabled })}
      >
        Toggle Ghost
      </button>

      <button
        type="button"
        data-testid="changeFontSize"
        onClick={() => updateSettings({ fontSize: 16 })}
      >
        Font 16
      </button>

      <button
        type="button"
        data-testid="enableAiCopilot"
        onClick={() => updateSettings({ aiCopilotEnabled: true })}
      >
        Enable AI
      </button>

      <button type="button" data-testid="resetBtn" onClick={() => resetSettings()}>
        Reset
      </button>
    </div>
  );
};

describe("SettingsContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("khởi tạo với đúng các giá trị mặc định theo hợp đồng (AC4)", () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    expect(screen.getByTestId("lineNumbers").textContent).toBe("true");
    expect(screen.getByTestId("lineWrapping").textContent).toBe("true");
    expect(screen.getByTestId("highlightActiveLine").textContent).toBe("true");
    expect(screen.getByTestId("fontSize").textContent).toBe("14");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("contrastBoost").textContent).toBe("false");
    expect(screen.getByTestId("ghostTextEnabled").textContent).toBe("true"); // BẬT (MĐ)
    expect(screen.getByTestId("dropdownAutocomplete").textContent).toBe("false"); // TẮT (MĐ)
    expect(screen.getByTestId("aiCopilotEnabled").textContent).toBe("false"); // TẮT (MĐ)
  });

  it("updateSettings cập nhật state và ghi vào localStorage đúng key sqllens_settings_v1 (AC5)", () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    act(() => {
      screen.getByTestId("toggleGhost").click();
    });

    expect(screen.getByTestId("ghostTextEnabled").textContent).toBe("false");

    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(saved.ghostTextEnabled).toBe(false);
    expect(saved.fontSize).toBe(14);

    act(() => {
      screen.getByTestId("changeFontSize").click();
    });

    expect(screen.getByTestId("fontSize").textContent).toBe("16");
    const updated = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(updated.fontSize).toBe(16);
    expect(updated.ghostTextEnabled).toBe(false);
  });

  it("resetSettings khôi phục toàn bộ cài đặt về DEFAULT_SETTINGS", () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    act(() => {
      screen.getByTestId("enableAiCopilot").click();
    });
    expect(screen.getByTestId("aiCopilotEnabled").textContent).toBe("true");

    act(() => {
      screen.getByTestId("resetBtn").click();
    });

    expect(screen.getByTestId("aiCopilotEnabled").textContent).toBe("false");
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    expect(saved).toEqual(DEFAULT_SETTINGS);
  });

  it("tự động đọc và phục hồi cấu hình đã lưu từ localStorage khi khởi động (AC5)", () => {
    const savedCustom = {
      ...DEFAULT_SETTINGS,
      fontSize: 16,
      theme: "light",
      ghostTextEnabled: false,
      dropdownAutocomplete: true,
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(savedCustom));

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    expect(screen.getByTestId("fontSize").textContent).toBe("16");
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(screen.getByTestId("ghostTextEnabled").textContent).toBe("false");
    expect(screen.getByTestId("dropdownAutocomplete").textContent).toBe("true");
  });

  it("ca biên: localStorage chứa JSON lỗi cú pháp, tự khôi phục về mặc định an toàn (AC5)", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, "invalid-json-content{{{");

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    expect(screen.getByTestId("fontSize").textContent).toBe("14");
    expect(screen.getByTestId("ghostTextEnabled").textContent).toBe("true");
  });

  it("ca biên: sanitizeSettings lọc dữ liệu sai kiểu hoặc giá trị enum bất hợp lệ", () => {
    const corrupted = {
      fontSize: 99, // Không thuộc 13 | 14 | 16
      theme: "neon-cyberpunk", // Không thuộc dark | light | auto
      lineNumbers: "yes", // Sai kiểu
      ghostTextEnabled: 123, // Sai kiểu
    };

    const sanitized = sanitizeSettings(corrupted);
    expect(sanitized.fontSize).toBe(14);
    expect(sanitized.theme).toBe("dark");
    expect(sanitized.lineNumbers).toBe(true);
    expect(sanitized.ghostTextEnabled).toBe(true);
    expect(sanitized.dropdownAutocomplete).toBe(false);

    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("string")).toEqual(DEFAULT_SETTINGS);
  });

  it("ca biên: localStorage.setItem ném lỗi QuotaExceeded hoặc SecurityError không làm crash app", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>
    );

    expect(() => {
      act(() => {
        screen.getByTestId("toggleGhost").click();
      });
    }).not.toThrow();

    expect(screen.getByTestId("ghostTextEnabled").textContent).toBe("false");
  });

  it("ném lỗi khi useSettings được gọi bên ngoài SettingsProvider", () => {
    const ComponentOutside = () => {
      useSettings();
      return null;
    };

    expect(() => render(<ComponentOutside />)).toThrow(
      "useSettings must be used within a SettingsProvider"
    );
  });
});
