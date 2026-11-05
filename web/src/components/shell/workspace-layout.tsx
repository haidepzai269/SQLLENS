"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Code, Network, SquareTerminal, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopLayout } from "./desktop-layout";
import { ZONES, type Zone } from "./layout-state";
import { useShell } from "./shell-provider";

export type WorkspaceZones = Record<Zone, ReactNode>;

const MOBILE_QUERY = "(max-width: 900px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
// null ở server và lần render đầu: chưa biết là điện thoại hay máy tính.
const useIsMobile = () =>
  useSyncExternalStore<boolean | null>(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => null);

const TAB_ICON: Record<Zone, typeof Code> = { sql: Code, stage: Network, findings: TriangleAlert, terminal: SquareTerminal };
const BG: Record<Zone, string> = { sql: "bg-surface", stage: "bg-stage", findings: "bg-surface", terminal: "bg-stage" };

function Region({ zone, label, children, className = "" }: { zone: Zone; label: string; children: ReactNode; className?: string }) {
  const Tag = zone === "stage" ? "main" : "section";
  return (
    <Tag
      id={zone}
      aria-label={label}
      tabIndex={-1}
      className={`h-full min-h-0 min-w-0 overflow-auto ${BG[zone]} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function WorkspaceLayout(props: WorkspaceZones) {
  const t = useTranslations("shell");
  const { ready, setHasWorkspace, mobileTab, setMobileTab } = useShell();
  const mobile = useIsMobile();
  useEffect(() => {
    setHasWorkspace(true);
    return () => setHasWorkspace(false);
  }, [setHasWorkspace]);

  if (mobile === null || !ready) {
    return (
      <div className="flex-1 p-[var(--edge)]" aria-busy>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  const region = (z: Zone) => (
    <Region zone={z} label={t(`zone.${z}`)}>
      {props[z]}
    </Region>
  );

  if (mobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {ZONES.map((z) => (
            <div key={z} hidden={z !== mobileTab} role="tabpanel" id={`panel-${z}`} aria-labelledby={`tab-${z}`} className="h-full">
              {region(z)}
            </div>
          ))}
        </div>
        <PhoneTabs value={mobileTab} onChange={setMobileTab} />
      </div>
    );
  }

  return <DesktopLayout zones={props} />;
}

function PhoneTabs({ value, onChange }: { value: Zone; onChange: (z: Zone) => void }) {
  const t = useTranslations("shell");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ZONES.indexOf(value);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ZONES.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const z = ZONES[(next + ZONES.length) % ZONES.length];
    onChange(z);
    refs.current[ZONES.indexOf(z)]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("zone.label")}
      onKeyDown={onKeyDown}
      className="grid h-14 flex-none grid-cols-4 border-t border-line bg-surface"
    >
      {ZONES.map((z, i) => {
        const Icon = TAB_ICON[z];
        return (
          <button
            key={z}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${z}`}
            aria-selected={z === value}
            aria-controls={`panel-${z}`}
            tabIndex={z === value ? 0 : -1}
            onClick={() => onChange(z)}
            className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs leading-4 text-dim aria-selected:text-text aria-selected:after:absolute aria-selected:after:-top-px aria-selected:after:left-1/2 aria-selected:after:h-px aria-selected:after:w-10 aria-selected:after:-translate-x-1/2 aria-selected:after:bg-lamp"
          >
            <Icon aria-hidden className="size-[18px]" />
            {t(`tab.${z}`)}
          </button>
        );
      })}
    </div>
  );
}
