"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface StageErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
  title?: string;
  resetLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class StageErrorBoundaryCore extends Component<
  StageErrorBoundaryProps & { defaultTitle: string; defaultReset: string },
  State
> {
  constructor(props: StageErrorBoundaryProps & { defaultTitle: string; defaultReset: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("StageErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  override render() {
    if (this.state.hasError) {
      const title = this.props.title ?? this.props.defaultTitle;
      const resetLabel = this.props.resetLabel ?? this.props.defaultReset;
      const errorMessage = this.state.error?.message || String(this.state.error);

      return (
        <Alert
          variant="destructive"
          role="alert"
          data-testid="stage-error-boundary"
          className="border-destructive/40 bg-surface/80"
        >
          <AlertCircle className="size-4" />
          <AlertTitle className="text-sm font-semibold">{title}</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col items-start gap-3">
            <p className="text-xs text-muted-foreground font-mono break-all">{errorMessage}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={this.handleReset}
              data-testid="stage-error-retry"
            >
              {resetLabel}
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

/**
 * Error boundary bảo vệ từng tab trong Stage.
 * Bắt ngoại lệ JavaScript runtime và hiển thị hộp thông báo kèm nút "Thử lại".
 */
export function StageErrorBoundary({ children, onReset, title, resetLabel }: StageErrorBoundaryProps) {
  const t = useTranslations("labStage.errorBoundary");
  return (
    <StageErrorBoundaryCore
      onReset={onReset}
      title={title}
      resetLabel={resetLabel}
      defaultTitle={t("title")}
      defaultReset={t("retry")}
    >
      {children}
    </StageErrorBoundaryCore>
  );
}
