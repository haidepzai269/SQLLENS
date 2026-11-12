"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Check, Crown, Loader2, Sparkles, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VipBadge } from "@/components/ui/vip-badge";
import { useAuth } from "@/modules/auth/auth-provider";
import { redeemVipCode, type RedeemErrorCode } from "./api/redeem";
import { SignInLink } from "@/modules/auth/guest";

export interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeModal({ open, onOpenChange }: UpgradeModalProps) {
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

  // Reset state mỗi khi mở modal
  useEffect(() => {
    if (open) {
      setCode(""); // eslint-disable-line react-hooks/set-state-in-effect -- Reset form state khi mở hộp thoại
      setLoading(false);
      setErrorKey(null);
      setErrorMessage(null);
      setSuccessInfo(null);
    }
  }, [open]);

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
      // Map error key sang bản dịch i18n
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

    // Định dạng ngày hết hạn
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
      /* giữ nguyên chuỗi gốc nếu lỗi parse */
    }

    setSuccessInfo({
      vipUntil: res.vipUntil,
      expiresFormatted: formattedDate,
    });

    // Cập nhật ngay Context Auth để Header/Avatar hiển thị Badge VIP tức thì
    try {
      await refreshUser();
    } catch {
      /* không chặn UI nếu refreshUser gặp vấn đề */
    }
  };

  const isUserVip = Boolean(user?.isVip || user?.role === "vip");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="text-center sm:text-left space-y-2">
          <div className="flex items-center gap-2">
            <VipBadge size="md" />
            <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {t("title")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("subtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* Bảng so sánh 2 cột trực quan */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
          {/* Cột 1: Gói Miễn Phí (Free) */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-5 flex flex-col justify-between relative">
            {!isUserVip && (
              <Badge variant="secondary" className="absolute top-4 right-4 text-[10px]">
                {t("comparison.currentBadge")}
              </Badge>
            )}
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-base text-foreground">
                  {t("comparison.freePlanTitle")}
                </h3>
                <p className="text-lg font-bold text-muted-foreground mt-1">
                  {t("comparison.freePlanPrice")}
                </p>
              </div>

              <div className="h-px bg-border/50 my-3" />

              <ul className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature1")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature2")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature3")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.freeFeature4")}</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Cột 2: Gói VIP Hoàng Gia (VIP / Pro) */}
          <div className="rounded-xl border-2 border-amber-400/80 dark:border-amber-400/60 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent p-5 flex flex-col justify-between relative shadow-sm">
            <Badge className="absolute top-4 right-4 bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-[10px] border-none shadow-xs">
              {isUserVip ? t("comparison.currentBadge") : t("comparison.vipPlanBadge")}
            </Badge>

            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <Crown className="size-4 text-amber-500" aria-hidden="true" />
                  <h3 className="font-bold text-base text-amber-500 dark:text-amber-400">
                    {t("comparison.vipPlanTitle")}
                  </h3>
                </div>
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-300 mt-1">
                  {t("comparison.vipPlanPrice")}
                </p>
              </div>

              <div className="h-px bg-amber-500/20 my-3" />

              <ul className="space-y-2.5 text-xs text-foreground/90 font-medium">
                <li className="flex items-start gap-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature1")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature2")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature3")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{t("comparison.vipFeature4")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Khu vực Nạp Mã Kích Hoạt (Promo Code / Voucher) */}
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-muted/20 p-5 space-y-4">
          {successInfo ? (
            /* Thông báo thành công */
            <div
              data-testid="redeem-success-card"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5 text-center space-y-3"
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
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-6"
              >
                {t("redeem.finishButton")}
              </Button>
            </div>
          ) : (
            /* Form nhập mã kích hoạt */
            <form onSubmit={handleRedeem} className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Crown className="size-4 text-amber-500" aria-hidden="true" />
                  <h4 className="text-sm font-semibold text-foreground">
                    {t("redeem.title")}
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("redeem.description")}
                </p>
              </div>

              {/* Nếu chưa đăng nhập: Cảnh báo cần đăng nhập */}
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
                    autoFocus
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

              {/* Thông báo lỗi */}
              {errorMessage && (
                <div
                  role="alert"
                  data-testid="redeem-error-message"
                  className="flex items-center gap-2 text-xs text-destructive font-medium pt-1"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UpgradeModal;
