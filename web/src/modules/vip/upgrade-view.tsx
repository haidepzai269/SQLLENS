"use client";

import * as React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Crown, Loader2, Sparkles, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { VipBadge } from "@/components/ui/vip-badge";
import { useAuth } from "@/modules/auth/auth-provider";
import { redeemVipCode, type RedeemErrorCode } from "./api/redeem";
import { SignInLink } from "@/modules/auth/guest";

export function UpgradeView() {
  const t = useTranslations("vip");
  const { status, user, refreshUser } = useAuth();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<RedeemErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    vipUntil: string;
    expiresFormatted: string;
  } | null>(null);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setErrorKey("empty_code");
      setErrorMessage(t("errors.emptyCode"));
      return;
    }

    if (status !== "user") {
      setErrorKey("auth_required");
      setErrorMessage(t("errors.authRequired"));
      return;
    }

    setLoading(true);
    setErrorKey(null);
    setErrorMessage(null);

    const res = await redeemVipCode(trimmed);
    setLoading(false);

    if (!res.success) {
      setErrorKey(res.errorCode);
      switch (res.errorCode) {
        case "invalid_code":
          setErrorMessage(t("errors.invalidCode"));
          break;
        case "code_exhausted":
          setErrorMessage(t("errors.codeExhausted"));
          break;
        case "code_already_redeemed":
          setErrorMessage(t("errors.codeAlreadyRedeemed"));
          break;
        case "auth_required":
          setErrorMessage(t("errors.authRequired"));
          break;
        default:
          setErrorMessage(res.message || t("errors.internal"));
          break;
      }
      return;
    }

    let formattedDate = res.vipUntil;
    try {
      if (res.vipUntil) {
        const d = new Date(res.vipUntil);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        }
      }
    } catch {
      /* giữ nguyên chuỗi */
    }

    setSuccessInfo({
      vipUntil: res.vipUntil,
      expiresFormatted: formattedDate,
    });

    try {
      await refreshUser();
    } catch {
      /* ignore */
    }
  };

  const isUserVip = Boolean(user?.isVip || user?.role === "vip");

  return (
    <main className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Nút quay lại */}
        <div>
          <Link
            href="/lab"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
          >
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            <span>{t("backToLab")}</span>
          </Link>
        </div>

        {/* Tiêu đề & Giới thiệu */}
        <div className="space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2">
            <VipBadge size="md" />
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {t("title")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>

        {/* Bảng so sánh 2 cột */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Cột Free */}
          <Card className="border border-border/70 bg-card/60 relative">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold">
                  {t("comparison.freePlanTitle")}
                </CardTitle>
                {!isUserVip && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("comparison.currentBadge")}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xl font-bold text-foreground/80 pt-1">
                {t("comparison.freePlanPrice")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-xs text-muted-foreground divide-y divide-border/30">
                <li className="flex items-start gap-2.5 pt-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature1")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature2")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature3")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature4")}</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Cột VIP */}
          <Card className="border-2 border-amber-400/80 dark:border-amber-400/60 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent relative shadow-md">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Crown className="size-4 text-amber-500" aria-hidden="true" />
                  <CardTitle className="text-lg font-bold text-amber-500 dark:text-amber-400">
                    {t("comparison.vipPlanTitle")}
                  </CardTitle>
                </div>
                <Badge className="bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-[10px] border-none shadow-xs">
                  {isUserVip ? t("comparison.currentBadge") : t("comparison.vipPlanBadge")}
                </Badge>
              </div>
              <CardDescription className="text-sm font-semibold text-amber-600 dark:text-amber-300 pt-1">
                {t("comparison.vipPlanPrice")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-xs text-foreground/90 font-medium divide-y divide-amber-500/20">
                <li className="flex items-start gap-2.5 pt-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature1")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature2")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature3")}</span>
                </li>
                <li className="flex items-start gap-2.5 pt-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature4")}</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Khối Kích hoạt Voucher */}
        <Card className="border border-amber-500/30 bg-card/90">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Crown className="size-4 text-amber-500" aria-hidden="true" />
              <CardTitle className="text-base font-bold">
                {t("redeem.title")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              {t("redeem.description")}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {successInfo ? (
              <div
                data-testid="page-redeem-success-card"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-6 text-center space-y-3"
              >
                <div className="inline-flex size-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500 mx-auto">
                  <ShieldCheck className="size-6" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {t("redeem.successTitle")}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t("redeem.successSubtitle")}
                  </p>
                  {successInfo.expiresFormatted && (
                    <p className="text-sm font-semibold text-amber-500 pt-1">
                      {t("redeem.expiresAt", { date: successInfo.expiresFormatted })}
                    </p>
                  )}
                </div>
                <Link href="/lab">
                  <Button
                    type="button"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-6"
                  >
                    {t("redeem.finishButton")}
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleRedeem} className="space-y-3">
                {status !== "user" && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                      <span>{t("redeem.loginRequiredWarning")}</span>
                    </div>
                    <SignInLink className="shrink-0 text-xs underline font-semibold text-amber-600 dark:text-amber-400 hover:opacity-80">
                      {t("redeem.loginButton")}
                    </SignInLink>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
                  <div className="relative flex-1">
                    <Input
                      type="text"
                      value={code}
                      disabled={loading}
                      onChange={(e) => {
                        setCode(e.target.value.toUpperCase());
                        if (errorKey) {
                          setErrorKey(null);
                          setErrorMessage(null);
                        }
                      }}
                      placeholder={t("redeem.placeholder")}
                      className="font-mono text-sm tracking-wider uppercase border-border/80 focus-visible:border-amber-500 focus-visible:ring-amber-500/30"
                      aria-label={t("redeem.title")}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || !code.trim()}
                    className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-semibold shrink-0"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-1.5" aria-hidden="true" />
                        <span>{t("redeem.activating")}</span>
                      </>
                    ) : (
                      <>
                        <span>{t("redeem.submitButton")}</span>
                        <ArrowRight className="size-4 ml-1.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>

                {errorMessage && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 text-xs text-destructive font-medium pt-1"
                  >
                    <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default UpgradeView;
