"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Download, FileCode, Image as ImageIcon, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TableInfo } from "@/modules/data-lab/generate/plan-data";
import { captureErdPng, ErdCaptureError, type ErdCaptureStep } from "@/modules/export/capture/erd-png";
import { serializeSchema } from "@/modules/export/sql-serializer";
import type { ColumnSpec, ForeignKeySpec, TableSpec } from "@/modules/export/types";

export interface ExportMenuProps {
  engine: "postgres" | "mysql" | "sqlite";
  tables?: (TableSpec | TableInfo)[];
  schema?: (TableSpec | TableInfo)[]; // alias tương thích cho callers
  projectName?: string;
  disabled?: boolean;
  className?: string;
}

export function isTableSpec(table: TableSpec | TableInfo): table is TableSpec {
  return "foreignKeys" in table && Array.isArray((table as TableSpec).foreignKeys);
}

export function normalizeTableSpec(table: TableSpec | TableInfo): TableSpec {
  if (isTableSpec(table)) {
    return table;
  }

  const columns: ColumnSpec[] = (table.columns || []).map((col) => {
    const isIdentity =
      col.generated === "identity_always" ||
      col.generated === "identity_default" ||
      col.generated === "serial";
    return {
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      primaryKey: col.isPrimaryKey,
      unique: col.isUnique,
      isIdentity,
    };
  });

  const foreignKeys: ForeignKeySpec[] = [];
  for (const col of table.columns || []) {
    if (col.references && col.references.table && col.references.column) {
      foreignKeys.push({
        columns: [col.name],
        refTable: col.references.table,
        refColumns: [col.references.column],
      });
    }
  }

  return {
    name: table.name,
    columns,
    foreignKeys,
  };
}

export function normalizeTables(tables: (TableSpec | TableInfo)[]): TableSpec[] {
  return tables.map(normalizeTableSpec);
}

export function sanitizeFileName(name?: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "sqllens";
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "sqllens";
}

export function formatExportTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

export function getExportFileName(projectName: string | undefined, now: Date): string {
  const cleanProject = sanitizeFileName(projectName);
  const timeStr = formatExportTimestamp(now);
  return `${cleanProject}-schema-${timeStr}.sql`;
}

export function getErdFileName(projectName: string | undefined, now: Date): string {
  return `${sanitizeFileName(projectName)}-erd-${formatExportTimestamp(now)}.png`;
}

/** Một chỗ duy nhất cho việc tải file: 100% client-side, 0 byte gửi mạng (Core Rule 7). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Thu hồi ở nhịp sau: revoke ngay sau click có trình duyệt huỷ luôn lượt tải.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportMenu({
  engine,
  tables: propTables,
  schema: propSchema,
  projectName,
  disabled = false,
  className,
}: ExportMenuProps) {
  const t = useTranslations("export");
  const titleId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pngStep, setPngStep] = useState<ErdCaptureStep | null>(null);
  // Giữ nguyên câu thông báo (không phải mã trạng thái) để live region đọc đúng lý do thất bại.
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const busy = isExporting || pngStep !== null;
  const pngStepText = pngStep ? t(`pngStep.${pngStep}`) : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const normalizedTables = useMemo(() => {
    const raw = propTables ?? propSchema ?? [];
    return normalizeTables(raw);
  }, [propTables, propSchema]);
  const isEmpty = normalizedTables.length === 0;

  const closeMenu = () => {
    setIsOpen(false);
  };

  // Đóng khi click ngoài container
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  // Bắt phím Escape toàn cục khi menu mở
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Focus trap: Focus phần tử tương tác đầu tiên khi mở menu
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length > 0) {
          focusables[0].focus();
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleTriggerClick = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;

    const firstElement = focusables[0];
    const lastElement = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement || document.activeElement === panel) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  const handleDownloadSql = () => {
    // Chặn bấm lặp khi đang xuất hoặc khi schema rỗng
    if (busy || isEmpty) return;

    setIsExporting(true);
    setLastNotice(null);

    try {
      const now = new Date();
      const fileName = getExportFileName(projectName, now);
      const sqlContent = serializeSchema({
        tables: normalizedTables,
        engine,
        projectName: projectName?.trim() || "sqllens",
        now,
      });

      // Tạo Blob và trigger download (100% client-side, 0 byte mạng theo Core Rule 7)
      saveBlob(new Blob([sqlContent], { type: "application/sql;charset=utf-8" }), fileName);

      setLastNotice(t("done"));
      toast.success(t("done"));
      closeMenu();
      triggerRef.current?.focus();
    } catch {
      setLastNotice(t("failed"));
      toast.error(t("failed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPng = async () => {
    if (busy || isEmpty) return;

    setLastNotice(null);
    setPngStep("prepare");
    try {
      const blob = await captureErdPng({ onProgress: setPngStep });
      saveBlob(blob, getErdFileName(projectName, new Date()));
      setLastNotice(t("pngDone"));
      toast.success(t("pngDone"));
      closeMenu();
      triggerRef.current?.focus();
    } catch (e) {
      const reason = e instanceof ErdCaptureError && e.code === "not_found" ? t("pngNotFound") : t("pngFailed");
      setLastNotice(reason);
      toast.error(reason);
    } finally {
      setPngStep(null);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block text-left", className)}>
      {/* Nút trigger ExportMenu */}
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t("title")}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="h-7 gap-1.5 px-2.5 text-xs font-medium"
        data-testid="export-menu-trigger"
      >
        <Download className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t("title")}</span>
      </Button>

      {/* Thông báo trạng thái hỗ trợ Screen Reader & Testing (luôn mounted để live region thông báo khi menu đóng) */}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="export-status"
      >
        {isExporting && t("exporting")}
        {pngStepText}
        {!busy && lastNotice}
      </div>

      {/* Menu Dropdown (Desktop) & Bottom Sheet (Mobile 390px) */}
      {isOpen && (
        <>
          {/* Lớp nền mờ trên mobile */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs sm:hidden"
            onClick={closeMenu}
            data-testid="export-menu-backdrop"
            aria-hidden="true"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="export-menu-panel"
            onKeyDown={handlePanelKeyDown}
            className={cn(
              "z-50 flex flex-col bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none",
              // Mobile: Bottom sheet
              "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t p-3",
              // Desktop: Popover dropdown góc phải Stage header
              "sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:left-auto sm:mt-1.5 sm:w-72 sm:rounded-xl sm:border sm:p-2"
            )}
          >
            {/* Header: Tiêu đề Sheet & Nút Đóng */}
            <div className="flex items-center justify-between border-b pb-2 px-1">
              <span id={titleId} className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("sheetTitle")}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={closeMenu}
                aria-label={t("close")}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                data-testid="export-menu-close"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>

            {/* Danh sách các mục xuất dữ liệu */}
            <div className="mt-2 flex flex-col gap-1">
              <button
                type="button"
                disabled={isEmpty || busy}
                aria-disabled={isEmpty || busy}
                title={isEmpty ? t("disabledEmpty") : t("sql")}
                onClick={handleDownloadSql}
                className={cn(
                  "group flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors",
                  isEmpty || busy
                    ? "cursor-not-allowed opacity-50 bg-muted/20"
                    : "hover:bg-accent hover:text-accent-foreground cursor-pointer"
                )}
                data-testid="export-sql-item"
              >
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {isExporting ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileCode className="size-3.5" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-xs font-medium text-foreground">
                    {isExporting ? t("exporting") : t("sql")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {isEmpty ? t("disabledEmpty") : t("sqlDescription")}
                  </span>
                </div>
              </button>

              <button
                type="button"
                disabled={isEmpty || busy}
                aria-disabled={isEmpty || busy}
                title={isEmpty ? t("disabledEmpty") : t("png")}
                onClick={handleDownloadPng}
                className={cn(
                  "group flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors",
                  isEmpty || busy
                    ? "cursor-not-allowed opacity-50 bg-muted/20"
                    : "hover:bg-accent hover:text-accent-foreground cursor-pointer"
                )}
                data-testid="export-png-item"
              >
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {pngStep ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="size-3.5" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-xs font-medium text-foreground">{pngStepText ?? t("png")}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {isEmpty ? t("disabledEmpty") : pngStepText ?? t("pngDescription")}
                  </span>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
