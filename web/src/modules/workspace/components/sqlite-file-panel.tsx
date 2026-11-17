"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/shell/tip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EngineId } from "@/contracts/engine";
import type { SqliteAdapter } from "@/engines/sqlite/adapter";
import { exportSqliteFile, sqliteExportName } from "@/engines/sqlite/export-file";
import { importSqliteFile, MAX_IMPORT_BYTES, SqliteImportError } from "@/engines/sqlite/import-file";

export type SqliteFilePanelProps = {
  engine: EngineId;
  projectName: string;
  /** Sandbox đang có bảng hoặc có SQL: nhập file sẽ thay thế nội dung đang có, nên phải hỏi trước. */
  hasContent: boolean;
  /** Lấy adapter SQLite dùng chung với vùng chạy (tạo nếu chưa có). */
  ensureAdapter: () => Promise<SqliteAdapter>;
  /** Gọi sau khi nạp xong, để Lab đọc lại schema thật từ database vừa nhập. */
  onImported: (info: { tables: string[]; bytes: number; name: string }) => void | Promise<void>;
  /** Đang chạy SQL thì không cho nhập (sẽ thay database ngay dưới chân câu đang chạy). */
  busy?: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "importing"; file: File }
  | { kind: "exporting" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

const ACCEPT = ".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3";

/** Dung lượng dễ đọc: 40.0 MB, 812.0 KB, 12 B. Chỉ để hiển thị, không dùng để quyết định gì. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SqliteFilePanel({ engine, projectName, hasContent, ensureAdapter, onImported, busy = false }: SqliteFilePanelProps) {
  const t = useTranslations("labStage");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // File đang chờ người dùng xác nhận thay thế sandbox hiện tại.
  const [pending, setPending] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const sqlite = engine === "sqlite";
  const importing = status.kind === "importing";
  const exporting = status.kind === "exporting";
  const size = formatBytes;
  const errorText = (e: unknown) => {
    if (e instanceof SqliteImportError) {
      return t(`file.error.${e.code}` as "file.error.NOT_SQLITE", {
        limit: MAX_IMPORT_BYTES / (1024 * 1024),
        message: e.message,
      });
    }
    return t("file.error.IMPORT_FAILED", { limit: MAX_IMPORT_BYTES / (1024 * 1024), message: (e as Error).message });
  };

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    // Thu hồi sau khi trình duyệt kịp bắt đầu tải.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function startImport(file: File) {
    setPending(null);
    const ctl = (abort.current = new AbortController());
    setStatus({ kind: "importing", file });
    try {
      const adapter = await ensureAdapter();
      const result = await importSqliteFile(file, adapter, { signal: ctl.signal });
      await onImported({ ...result, name: file.name });
      if (!alive.current) return;
      setStatus({
        kind: "done",
        text:
          result.tables.length > 0
            ? t("file.imported", { name: file.name, count: result.tables.length, size: size(result.bytes) })
            : t("file.importedEmpty", { name: file.name, size: size(result.bytes) }),
      });
    } catch (e) {
      if (!alive.current) return;
      // Huỷ thì về trạng thái nghỉ, không báo lỗi.
      setStatus(ctl.signal.aborted ? { kind: "idle" } : { kind: "error", text: errorText(e) });
    } finally {
      if (abort.current === ctl) abort.current = null;
      if (input.current) input.current.value = ""; // chọn lại đúng file đó lần nữa vẫn phải chạy
    }
  }

  async function startExport(): Promise<boolean> {
    setStatus({ kind: "exporting" });
    try {
      const adapter = await ensureAdapter();
      const blob = await exportSqliteFile(adapter, sqliteExportName(projectName));
      if (!alive.current) return true;
      download(blob, blob.name);
      setStatus({ kind: "done", text: t("file.exported", { name: blob.name, size: size(blob.size) }) });
      return true;
    } catch (e) {
      if (!alive.current) return false;
      setStatus({ kind: "error", text: t("file.exportFailed", { message: (e as Error).message }) });
      return false;
    }
  }

  const onPick = (file: File | undefined) => {
    if (!file) return;
    // Có nội dung đang dở thì hỏi trước, vì nhập file là thay cả database (Sally, Task134 AC5).
    if (hasContent) setPending(file);
    else void startImport(file);
  };

  const disabledTip = !sqlite ? t("file.tip.onlySqlite") : busy ? t("file.tip.busy") : null;
  const blocked = !sqlite || busy || importing || exporting;

  return (
    <div className="flex items-center gap-1.5">
      {(status.kind === "done" || status.kind === "error") && (
        <span
          role={status.kind === "error" ? "alert" : "status"}
          data-testid="sqlite-file-status"
          title={status.text}
          className={`max-w-[11rem] truncate text-[11px] sm:max-w-[16rem] ${status.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status.text}
        </span>
      )}
      {status.kind === "importing" && (
        <span role="status" data-testid="sqlite-file-status" className="max-w-[11rem] truncate text-[11px] text-muted-foreground" title={status.file.name}>
          {t("file.importing", { name: status.file.name })}
        </span>
      )}
      {exporting && (
        <span role="status" data-testid="sqlite-file-status" className="text-[11px] text-muted-foreground">
          {t("file.exporting")}
        </span>
      )}

      {(importing || exporting) && (
        <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()} aria-label={t("file.cancel")}>
          {t("file.cancel")}
        </Button>
      )}

      <Tip label={disabledTip ?? t("file.tip.import")} side="bottom">
        <Button
          size="sm"
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={blocked}
          aria-label={t("file.import")}
          data-testid="sqlite-import"
        >
          <Upload className="h-4 w-4" aria-hidden />
        </Button>
      </Tip>
      <Tip label={disabledTip ?? t("file.tip.export")} side="bottom">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void startExport()}
          disabled={blocked}
          aria-label={t("file.export")}
          data-testid="sqlite-export"
        >
          <Download className="h-4 w-4" aria-hidden />
        </Button>
      </Tip>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="sqlite-file-input"
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="w-full max-w-[calc(100%-2rem)] gap-4 p-5 sm:max-w-md">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle>{t("file.replace.title")}</DialogTitle>
            <DialogDescription>{t("file.replace.body", { name: pending?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("file.cancel")}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const file = pending;
                // Xuất hỏng thì ở lại hộp thoại: không thay database khi chưa lưu được bản cũ.
                if (file && (await startExport())) await startImport(file);
              }}
            >
              {t("file.replace.exportFirst")}
            </Button>
            <Button onClick={() => pending && void startImport(pending)} data-testid="sqlite-import-confirm">
              {t("file.replace.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
