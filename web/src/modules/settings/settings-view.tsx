"use client";

import React, { useContext, useState } from "react";
import {
  ArrowLeft,
  Code2,
  Palette,
  Sparkles,
  ShieldCheck,
  RotateCcw,
  Moon,
  Sun,
  Monitor,
  Crown,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSettings } from "@/contexts/settings-context";
import { CustomSwitch } from "@/components/ui/custom-switch";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VipBadge } from "@/components/ui/vip-badge";
import { AuthContext } from "@/modules/auth/auth-provider";
import { UpgradeModal } from "@/modules/vip/upgrade-modal";

export function SettingsView() {
  const t = useTranslations("settings");
  const { settings, updateSettings, resetSettings } = useSettings();
  const [resetNotice, setResetNotice] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const isVip = Boolean(user?.isVip || user?.role === "vip");

  const handleReset = () => {
    resetSettings();
    setResetNotice(true);
    setTimeout(() => setResetNotice(false), 3000);
  };

  return (
    <main className="min-h-full flex-1 bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Thanh điều hướng quay lại & Tiêu đề trang */}
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
              <span>{t("backToWorkspace")}</span>
            </Link>

            <div className="flex items-center gap-2">
              {resetNotice && (
                <span className="text-xs text-emerald-500 animate-in fade-in duration-200">
                  {t("resetSuccess")}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5 mr-1.5" aria-hidden="true" />
                <span>{t("resetDefault")}</span>
              </Button>
            </div>
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-heading">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </header>

        {/* 4 Phân khu Cài Đặt */}
        <div className="grid grid-cols-1 gap-6">
          {/* Phân khu 1: Soạn thảo SQL (Editor) */}
          <Card className="border border-border/60 bg-card/80 backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Code2 className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">
                    {t("sections.editor.title")}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    {t("sections.editor.description")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="divide-y divide-border/40 pt-2">
              {/* Line Numbers */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="setting-line-numbers" className="text-sm font-medium text-foreground cursor-pointer">
                    {t("sections.editor.lineNumbers.title")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.editor.lineNumbers.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-line-numbers"
                  checked={settings.lineNumbers}
                  onChange={(v) => updateSettings({ lineNumbers: v })}
                  aria-label={t("sections.editor.lineNumbers.title")}
                />
              </div>

              {/* Line Wrapping */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="setting-line-wrapping" className="text-sm font-medium text-foreground cursor-pointer">
                    {t("sections.editor.lineWrapping.title")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.editor.lineWrapping.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-line-wrapping"
                  checked={settings.lineWrapping}
                  onChange={(v) => updateSettings({ lineWrapping: v })}
                  aria-label={t("sections.editor.lineWrapping.title")}
                />
              </div>

              {/* Highlight Active Line */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="setting-highlight-active-line" className="text-sm font-medium text-foreground cursor-pointer">
                    {t("sections.editor.highlightActiveLine.title")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.editor.highlightActiveLine.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-highlight-active-line"
                  checked={settings.highlightActiveLine}
                  onChange={(v) => updateSettings({ highlightActiveLine: v })}
                  aria-label={t("sections.editor.highlightActiveLine.title")}
                />
              </div>

              {/* Font Size */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {t("sections.editor.fontSize.title")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.editor.fontSize.description")}
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1" role="radiogroup" aria-label={t("sections.editor.fontSize.title")}>
                  {([13, 14, 16] as const).map((size) => {
                    const isSelected = settings.fontSize === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => updateSettings({ fontSize: size })}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                        }`}
                      >
                        {size}px
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Phân khu 2: Giao diện & Màu sắc (Appearance) */}
          <Card className="border border-border/60 bg-card/80 backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Palette className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">
                    {t("sections.appearance.title")}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    {t("sections.appearance.description")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="divide-y divide-border/40 pt-2">
              {/* Theme Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {t("sections.appearance.theme.title")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.appearance.theme.description")}
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1" role="radiogroup" aria-label={t("sections.appearance.theme.title")}>
                  {(
                    [
                      { key: "dark", label: t("sections.appearance.theme.dark"), icon: Moon },
                      { key: "light", label: t("sections.appearance.theme.light"), icon: Sun },
                      { key: "auto", label: t("sections.appearance.theme.auto"), icon: Monitor },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => {
                    const isSelected = settings.theme === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => updateSettings({ theme: key })}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                        }`}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Contrast Boost */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="setting-contrast-boost" className="text-sm font-medium text-foreground cursor-pointer">
                    {t("sections.appearance.contrastBoost.title")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.appearance.contrastBoost.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-contrast-boost"
                  checked={settings.contrastBoost}
                  onChange={(v) => updateSettings({ contrastBoost: v })}
                  aria-label={t("sections.appearance.contrastBoost.title")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Phân khu 3: Trợ lý soạn thảo & Gợi ý mã (Autocomplete) */}
          <Card className="border border-border/60 bg-card/80 backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">
                    {t("sections.autocomplete.title")}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    {t("sections.autocomplete.description")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="divide-y divide-border/40 pt-2">
              {/* Inline Ghost Text */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor="setting-ghost-text" className="text-sm font-medium text-foreground cursor-pointer">
                      {t("sections.autocomplete.ghostText.title")}
                    </label>
                    <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
                      0ms • 0đ
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.autocomplete.ghostText.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-ghost-text"
                  checked={settings.ghostTextEnabled}
                  onChange={(v) => updateSettings({ ghostTextEnabled: v })}
                  aria-label={t("sections.autocomplete.ghostText.title")}
                />
              </div>

              {/* Code-based Dropdown */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="setting-dropdown-autocomplete" className="text-sm font-medium text-foreground cursor-pointer">
                    {t("sections.autocomplete.dropdown.title")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.autocomplete.dropdown.description")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-dropdown-autocomplete"
                  checked={settings.dropdownAutocomplete}
                  onChange={(v) => updateSettings({ dropdownAutocomplete: v })}
                  aria-label={t("sections.autocomplete.dropdown.title")}
                />
              </div>

              {/* AI Copilot */}
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="setting-ai-copilot" className="text-sm font-medium text-foreground cursor-pointer">
                      {t("sections.autocomplete.aiCopilot.title")}
                    </label>
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-500 text-[10px] font-semibold"
                    >
                      <Crown className="size-3 text-amber-500" aria-hidden="true" />
                      <span>{t("sections.autocomplete.aiCopilot.vipBadge")}</span>
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("sections.autocomplete.aiCopilot.description")}
                  </p>
                  <p className="text-[11px] text-amber-500/90 font-medium">
                    ⚠️ {t("sections.autocomplete.aiCopilot.vipWarning")}
                  </p>
                </div>
                <CustomSwitch
                  id="setting-ai-copilot"
                  checked={settings.aiCopilotEnabled}
                  onChange={(v) => updateSettings({ aiCopilotEnabled: v })}
                  aria-label={t("sections.autocomplete.aiCopilot.title")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Phân khu 4: Tài khoản & Phân quyền (Account & VIP) */}
          <Card className="border border-border/60 bg-card/80 backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">
                    {t("sections.account.title")}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    {t("sections.account.description")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border/60 bg-muted/20">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("sections.account.currentPlan")}:
                    </span>
                    {isVip ? (
                      <VipBadge size="sm" />
                    ) : (
                      <Badge variant="secondary" className="font-semibold text-xs">
                        {t("sections.account.planFree")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isVip && user?.vipUntil
                      ? `Hạn dùng VIP: ${new Date(user.vipUntil).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}`
                      : t("sections.account.statusDescription")}
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  className="w-full sm:w-auto bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-semibold shadow-xs"
                >
                  <Crown className="size-4 mr-1.5" aria-hidden="true" />
                  <span>{isVip ? "Gia hạn VIP" : t("sections.account.upgradeButton")}</span>
                </Button>
              </div>

              {/* VIP Perks */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <Crown className="size-3.5" aria-hidden="true" />
                  <span>{t("sections.account.perksTitle")}</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-1.5 pl-1">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                    <span>{t("sections.account.perk1")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                    <span>{t("sections.account.perk2")}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                    <span>{t("sections.account.perk3")}</span>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {upgradeOpen && <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />}
    </main>
  );
}

export default SettingsView;
