"use client";

import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Gắn tooltip vào chính nút `children` (không thêm phần tử bọc). Base UI chỉ mở khi hover chuột hoặc focus bàn phím, chạm trên cảm ứng thì không mở nên không che thao tác.
export function Tip({
  label,
  children,
  side = "bottom",
  open,
  onOpenChange,
}: {
  label: string;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="max-w-64 text-pretty">{label}</TooltipContent>
    </Tooltip>
  );
}
