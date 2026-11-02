export const ZONES = ["sql", "stage", "findings", "terminal"] as const;
export type Zone = (typeof ZONES)[number];
export type SizedZone = Exclude<Zone, "stage">;
export type LayoutState = { open: Record<Zone, boolean>; size: Record<SizedZone, number> };

// Đơn vị px, theo bảng "Bố cục và các cột" trong EXPERIENCE.md.
export const LIMITS: Record<SizedZone, { def: number; min: number; max: number }> = {
  sql: { def: 320, min: 220, max: 560 },
  findings: { def: 348, min: 260, max: 560 },
  terminal: { def: 180, min: 96, max: 480 },
};
export const STORAGE_KEY = "sqllens.layout";

export const defaultState = (): LayoutState => ({
  open: { sql: true, stage: true, findings: true, terminal: true },
  size: { sql: LIMITS.sql.def, findings: LIMITS.findings.def, terminal: LIMITS.terminal.def },
});

export const clampSize = (zone: SizedZone, n: number) => Math.min(LIMITS[zone].max, Math.max(LIMITS[zone].min, Math.round(n)));

// Dữ liệu từ localStorage không đáng tin: từng trường sai thì về mặc định, không bao giờ để cả bốn vùng tắt.
export function sanitize(raw: unknown): LayoutState {
  const out = defaultState();
  if (!raw || typeof raw !== "object") return out;
  const { open, size } = raw as { open?: Record<string, unknown>; size?: Record<string, unknown> };
  const parsed = ZONES.map((z) => (typeof open?.[z] === "boolean" ? (open[z] as boolean) : true));
  if (parsed.some(Boolean)) ZONES.forEach((z, i) => (out.open[z] = parsed[i]));
  (Object.keys(LIMITS) as SizedZone[]).forEach((z) => {
    const v = size?.[z];
    if (typeof v === "number" && Number.isFinite(v)) out.size[z] = clampSize(z, v);
  });
  return out;
}

export const isLastOpen = (s: LayoutState, zone: Zone) => s.open[zone] && ZONES.filter((z) => s.open[z]).length === 1;

export function toggleZone(s: LayoutState, zone: Zone): LayoutState {
  if (isLastOpen(s, zone)) return s;
  return { ...s, open: { ...s.open, [zone]: !s.open[zone] } };
}
