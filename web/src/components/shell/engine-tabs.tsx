"use client";

import { Suspense, useRef } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import type { EngineId } from "@/contracts/engine";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Tip } from "./tip";

export const SELECTABLE: readonly EngineId[] = ["postgres", "mysql"];
// NoSQL và LSM-Tree chưa có trong V1: giữ tab khóa trên giao diện (CLAUDE.md).
export const LOCKED = ["nosql", "lsm"] as const;
export type LockedId = (typeof LOCKED)[number];
export const DEFAULT_ENGINE: EngineId = "postgres";

// Giá trị lạ trên URL (engine=abc) quy về mặc định, không crash.
export const parseEngine = (v: string | null | undefined): EngineId => SELECTABLE.find((e) => e === v) ?? DEFAULT_ENGINE;

const tabCls =
  "relative inline-flex h-full flex-none items-center gap-1.5 whitespace-nowrap px-2 text-dim hover:text-text aria-selected:font-medium aria-selected:text-text " +
  "aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:bottom-0 aria-selected:after:h-px aria-selected:after:bg-lamp";

type Props = { engine: EngineId; onSelect?: (e: EngineId) => void; onNote?: (id: LockedId | null) => void };
const isLocked = (id: string): id is LockedId => (LOCKED as readonly string[]).includes(id);

function View({ engine, onSelect, onNote }: Props) {
  const t = useTranslations("shell");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const all: string[] = [...SELECTABLE, ...LOCKED];

  // Mũi tên di chuyển focus giữa các tab, kể cả tab khóa để người dùng bàn phím đọc được lý do.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = refs.current.findIndex((b) => b === document.activeElement);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined || i < 0) return;
    e.preventDefault();
    refs.current[(next + all.length) % all.length]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("engines.label")}
      onKeyDown={onKeyDown}
      className="flex h-full min-w-0 overflow-x-auto [scrollbar-width:none]"
    >
      {all.map((id, i) => {
        const locked = isLocked(id);
        return (
          <Tip key={id} label={locked ? t("lockedReason", { engine: t(`engines.${id}`) }) : t(`tip.engine.${id}`)}>
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`engine-tab-${id}`}
            aria-selected={!locked && id === engine}
            aria-disabled={locked || undefined}
            tabIndex={id === engine ? 0 : -1}
            className={tabCls}
            onFocus={() => onNote?.(isLocked(id) ? id : null)}
            onClick={() => {
              if (isLocked(id)) return onNote?.(id);
              onNote?.(null);
              onSelect?.(id as EngineId);
            }}
          >
            {locked && <Lock aria-hidden className="size-3.5" />}
            {t(`engines.${id}`)}
          </button>
          </Tip>
        );
      })}
    </div>
  );
}

function Connected({ onNote }: { onNote: Props["onNote"] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const select = (e: EngineId) => {
    const q = new URLSearchParams(window.location.search);
    q.set("engine", e);
    router.replace(`${pathname}?${q}${window.location.hash}`);
  };
  return <View engine={parseEngine(params.get("engine"))} onSelect={select} onNote={onNote} />;
}

// useSearchParams cần Suspense khi trang được prerender: bản dự phòng hiện PostgreSQL mặc định.
export function EngineTabs({ onNote }: { onNote: Props["onNote"] }) {
  return (
    <Suspense fallback={<View engine={DEFAULT_ENGINE} />}>
      <Connected onNote={onNote} />
    </Suspense>
  );
}
