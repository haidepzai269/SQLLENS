"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { clampSize, LIMITS, type SizedZone, type Zone } from "./layout-state";
import { useShell } from "./shell-provider";

const STAGE_MIN = 160;
const COLUMNS_MIN = 120;
const ANIM_MS = 260;
const GONE_MS = ANIM_MS + 140; // chờ chuyển động xong rồi mới gỡ nội dung vùng đã tắt khỏi DOM

const BG: Record<Zone, string> = { sql: "bg-surface", stage: "bg-stage", findings: "bg-surface", terminal: "bg-stage" };
const ANIM = "group-data-[anim]/lay:transition-[width,height] group-data-[anim]/lay:duration-[260ms] group-data-[anim]/lay:ease-[cubic-bezier(0.32,0.72,0,1)]";

// Thanh chia: role=separator, kéo chuột và phím mũi tên. `dir` là dấu của độ dời con trỏ làm vùng đích to ra.
// Kéo ghi thẳng style của vùng đích (không render lại theo từng pixel, không transition) và chỉ chốt vào state khi thả.
function Sep({ zone, vertical, dir, label, value, reserve, onCommit, shown }: {
  zone: SizedZone;
  vertical?: boolean;
  dir: 1 | -1;
  label: string;
  value: number;
  reserve: number; // px của khung chứa phải dành cho phần còn lại, phần còn lại của khung là mức tối đa của vùng đích
  onCommit: (z: SizedZone, px: number) => void;
  shown: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const start = useRef({ at: 0, size: 0 });
  const self = useRef<HTMLDivElement>(null);
  const root = () => self.current?.closest<HTMLElement>("[data-layout]") ?? null;
  const target = () => root()?.querySelector<HTMLElement>(`[data-zone=${zone}]`) ?? null;
  const room = () => {
    const r = root()?.getBoundingClientRect();
    return r ? (vertical ? r.height : r.width) - reserve : LIMITS[zone].max;
  };
  const prop = vertical ? "height" : "width";
  const apply = (px: number) => clampSize(zone, Math.min(px, Math.max(LIMITS[zone].min, room())));
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = target();
    if (!el || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { at: vertical ? e.clientY : e.clientX, size: el.getBoundingClientRect()[prop] };
    delete root()?.dataset.anim;
    setDrag(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = target();
    if (!drag || !el) return;
    el.style[prop] = `${apply(start.current.size + dir * ((vertical ? e.clientY : e.clientX) - start.current.at))}px`;
  };
  const up = () => {
    const el = target();
    setDrag(false);
    if (drag && el) onCommit(zone, apply(el.getBoundingClientRect()[prop]));
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    const coord = (vertical ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 })[e.key as "ArrowUp"];
    const next = coord !== undefined ? value + dir * coord * step : e.key === "Home" ? LIMITS[zone].min : e.key === "End" ? LIMITS[zone].max : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onCommit(zone, apply(next));
  };
  return (
    <div
      ref={self}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={LIMITS[zone].min}
      aria-valuemax={LIMITS[zone].max}
      tabIndex={shown ? 0 : -1}
      inert={!shown}
      data-dragging={drag || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      className={
        `relative z-10 flex-none touch-none bg-line outline-none after:absolute hover:bg-lamp/60 focus-visible:bg-lamp data-[dragging]:bg-lamp ${ANIM} ` +
        (vertical ? "cursor-row-resize after:inset-x-0 after:-inset-y-1 " : "cursor-col-resize after:inset-y-0 after:-inset-x-1 ") +
        (shown ? (vertical ? "h-px" : "w-px") : vertical ? "h-0" : "w-0")
      }
    />
  );
}

// Vùng đã tắt vẫn nằm trong DOM tới khi chuyển động xong (để thu nhỏ dần chứ không biến mất), rồi gỡ hẳn như trước.
function useMounted(open: boolean) {
  const [gone, setGone] = useState(!open);
  if (open && gone) setGone(false);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setGone(true), GONE_MS);
    return () => clearTimeout(id);
  }, [open]);
  return !gone;
}

function Slot({ zone, open, label, size, vertical, children, style }: {
  zone: Zone;
  open: boolean;
  label: string;
  size?: number; // px khi mở: nội dung giữ cỡ này lúc co giãn để chữ không xuống dòng lại từng khung hình
  vertical?: boolean;
  children: ReactNode;
  style: CSSProperties;
}) {
  const mounted = useMounted(open);
  const Tag = zone === "stage" ? "main" : "section";
  return (
    <div data-zone={zone} style={style} inert={!open} className={`min-h-0 min-w-0 flex-none overflow-hidden ${ANIM}`}>
      {mounted && (
        <Tag
          id={zone}
          aria-label={label}
          tabIndex={-1}
          style={size ? (vertical ? { minHeight: size } : { minWidth: size }) : undefined}
          className={`h-full w-full min-w-0 overflow-auto ${BG[zone]}`}
        >
          {children}
        </Tag>
      )}
    </div>
  );
}

export function DesktopLayout({ zones }: { zones: Record<Zone, ReactNode> }) {
  const t = useTranslations("shell");
  const { state, commitSizes } = useShell();
  const root = useRef<HTMLDivElement>(null);
  const { open, size } = state;
  const sides = (["sql", "findings"] as const).filter((z) => open[z]);
  const cols = open.stage || sides.length > 0;

  // Bật data-anim cùng lượt render với lúc đổi bề rộng, để chỉ việc đóng mở có chuyển động. Kéo thanh chia và phím mũi tên đổi ngay.
  const key = `${open.sql}${open.stage}${open.findings}${open.terminal}`;
  const prev = useRef(key);
  useLayoutEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    const el = root.current;
    if (!el) return;
    el.dataset.anim = "";
    const id = setTimeout(() => delete el.dataset.anim, GONE_MS);
    return () => clearTimeout(id); // bấm tiếp giữa chừng: hẹn giờ mới, chuyển động tiếp từ bề rộng đang có
  }, [key]);

  const sideW = (z: SizedZone) => (!open[z] ? "0px" : open.stage ? `${size[z]}px` : `${100 / sides.length}%`);
  const reserve = (other: SizedZone) => STAGE_MIN + (open[other] ? size[other] : 0) + 2;
  const termReserve = cols ? COLUMNS_MIN + 1 : 0;
  const sep = { onCommit: (z: SizedZone, px: number) => commitSizes({ [z]: px }) };

  return (
    <div ref={root} data-layout className="group/lay flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Slot zone="sql" open={open.sql} label={t("zone.sql")} size={size.sql} style={{ width: sideW("sql") }}>{zones.sql}</Slot>
        <Sep {...sep} zone="sql" dir={1} label={t("resize.columns")} value={size.sql} reserve={reserve("findings")} shown={open.sql && open.stage} />
        <Slot zone="stage" open={open.stage} label={t("zone.stage")} style={{ flex: "1 1 0", width: 0 }}>{zones.stage}</Slot>
        <Sep {...sep} zone="findings" dir={-1} label={t("resize.columns")} value={size.findings} reserve={reserve("sql")} shown={open.stage && open.findings} />
        {/* Vùng giữa tắt: hai cột còn lại chia đều và chỉ có đường kẻ, không có gì để kéo. */}
        <div aria-hidden className={`flex-none bg-line ${ANIM} ${!open.stage && open.sql && open.findings ? "w-px" : "w-0"}`} />
        <Slot zone="findings" open={open.findings} label={t("zone.findings")} size={size.findings} style={{ width: sideW("findings") }}>{zones.findings}</Slot>
      </div>
      <Sep {...sep} zone="terminal" vertical dir={-1} label={t("resize.terminal")} value={size.terminal} reserve={termReserve} shown={open.terminal && cols} />
      <Slot zone="terminal" open={open.terminal} label={t("zone.terminal")} size={size.terminal} vertical style={{ height: open.terminal ? (cols ? `${size.terminal}px` : "100%") : "0px" }}>{zones.terminal}</Slot>
    </div>
  );
}
