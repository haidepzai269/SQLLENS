import * as React from "react";
import { Crown } from "lucide-react";
import { cn } from "cn";

export interface VipBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md";
  className?: string;
  showText?: boolean;
}

export function VipBadge({
  size = "sm",
  className,
  showText = true,
  ...props
}: VipBadgeProps) {
  const isSm = size === "sm";

  return (
    <span
      role="status"
      aria-label="VIP Member"
      data-size={size}
      className={cn(
        "inline-flex items-center font-bold tracking-wider select-none rounded-full border border-amber-400/60 dark:border-amber-400/50",
        "bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-500/20",
        "text-amber-600 dark:text-amber-300",
        "shadow-[0_0_10px_rgba(245,158,11,0.25)]",
        isSm ? "px-1.5 py-0.5 text-[10px] gap-1" : "px-2.5 py-1 text-xs gap-1.5",
        className
      )}
      {...props}
    >
      <Crown
        className={cn(
          "text-amber-500 dark:text-amber-300 shrink-0",
          isSm ? "size-3" : "size-3.5"
        )}
        aria-hidden="true"
      />
      {showText && <span>VIP</span>}
    </span>
  );
}
