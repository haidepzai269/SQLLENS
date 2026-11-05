"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "./gsap-setup";

// Cây mẫu 3 tầng cộng heap. Số chỉ là ví dụ, không phải dữ liệu của người dùng.
export type NodeId = "root" | "a" | "b" | "l0" | "l1" | "l2" | "l3" | "heap";
type Box = { cx: number; y: number; w: number; h: number; t: string };
export const NODES: Record<NodeId, Box> = {
  root: { cx: 200, y: 28, w: 120, h: 40, t: "5000" },
  a: { cx: 100, y: 140, w: 150, h: 40, t: "2500" },
  b: { cx: 300, y: 140, w: 150, h: 40, t: "7500" },
  l0: { cx: 52, y: 252, w: 90, h: 40, t: "1…2499" },
  l1: { cx: 148, y: 252, w: 90, h: 40, t: "2500…4999" },
  l2: { cx: 252, y: 252, w: 90, h: 40, t: "5000…7499" },
  l3: { cx: 348, y: 252, w: 90, h: 40, t: "7500…10000" },
  heap: { cx: 200, y: 340, w: 384, h: 40, t: "" },
};
const EDGES: [NodeId, NodeId][] = [
  ["root", "a"], ["root", "b"], ["a", "l0"], ["a", "l1"], ["b", "l2"], ["b", "l3"],
  ["l0", "heap"], ["l1", "heap"], ["l2", "heap"], ["l3", "heap"],
];
export const ROUTES: Record<string, NodeId[]> = {
  "1180": ["root", "a", "l0", "heap"],
  "3900": ["root", "a", "l1", "heap"],
  "7421": ["root", "b", "l2", "heap"],
  "9120": ["root", "b", "l3", "heap"],
};

const edgeId = (p: NodeId, c: NodeId) => `${p}-${c}`;
const pt = (id: NodeId, via?: NodeId) => ({ x: id === "heap" && via ? NODES[via].cx : NODES[id].cx, y: NODES[id].y });
const line = (p: NodeId, c: NodeId) => {
  const A = NODES[p], B = NODES[c];
  return { x1: A.cx, y1: A.y + A.h, x2: c === "heap" ? A.cx : B.cx, y2: B.y };
};

// Ẩn mọi vệt sáng và key để dựng lượt đi mới.
export function resetTree(svg: Element) {
  gsap.set(svg.querySelectorAll("[data-lit-n],[data-lit-e],[data-chip]"), { opacity: 0 });
}

// Thêm vào timeline một lần key đi từ route[0] đến cuối. Mỗi chặng kéo dài `hop`; label `s<i>` đặt lúc key tới node thứ i.
export function descent(tl: gsap.core.Timeline, svg: Element, route: NodeId[], key: string, hop: number) {
  const chip = svg.querySelector("[data-chip]")!;
  const txt = svg.querySelector("[data-chip-text]")!;
  txt.textContent = key;
  route.forEach((id, i) => {
    const prev = route[i - 1];
    const from = prev ? pt(prev, route[i - 2]) : { x: NODES[id].cx, y: -22 };
    const to = pt(id, prev);
    const at = i * hop;
    tl.fromTo(chip, { x: from.x, y: from.y, opacity: prev ? 1 : 0 }, { x: to.x, y: to.y, opacity: 1, duration: hop, ease: "power2.inOut" }, at);
    if (prev) tl.fromTo(svg.querySelector(`[data-lit-e="${edgeId(prev, id)}"]`), { opacity: 0 }, { opacity: 1, duration: hop }, at);
    tl.fromTo(svg.querySelector(`[data-lit-n="${id}"]`), { opacity: 0 }, { opacity: 1, duration: hop * 0.3 }, at + hop * 0.7);
    tl.addLabel(`s${i}`, at + hop);
  });
}

export const Tree = memo(function Tree({ label, lit = [] }: { label: string; lit?: NodeId[] }) {
  const t = useTranslations("landing.tree");
  const on = new Set(lit);
  return (
    <svg data-ui viewBox="0 0 400 392" role="img" aria-label={label} className="h-auto w-full overflow-visible">
      {EDGES.map(([p, c]) => {
        const l = line(p, c);
        return (
          <g key={edgeId(p, c)} aria-hidden>
            <line {...l} className="stroke-control" strokeWidth={1.5} />
            <line {...l} data-lit-e={edgeId(p, c)} className="stroke-lamp" strokeWidth={3} style={{ opacity: on.has(p) && on.has(c) ? 1 : 0 }} />
          </g>
        );
      })}
      {(Object.keys(NODES) as NodeId[]).map((id) => {
        const n = NODES[id];
        const x = n.cx - n.w / 2;
        return (
          <g key={id} aria-hidden>
            <rect x={x} y={n.y} width={n.w} height={n.h} rx={2} className={id === "heap" ? "fill-surface stroke-control" : "fill-raised stroke-control"} strokeWidth={1.5} />
            <rect data-lit-n={id} x={x} y={n.y} width={n.w} height={n.h} rx={2} fill="none" className="stroke-lamp" strokeWidth={3} style={{ opacity: on.has(id) ? 1 : 0 }} />
            <text x={id === "heap" ? x + 12 : n.cx} y={n.y + 25} textAnchor={id === "heap" ? "start" : "middle"} className="fill-ink2" style={{ font: "500 12.5px var(--mono)" }}>
              {id === "heap" ? t("heap") : n.t}
            </text>
          </g>
        );
      })}
      <g data-chip aria-hidden style={{ opacity: 0 }}>
        <rect x={-27} y={-11} width={54} height={22} rx={2} className="fill-lamp" />
        <text data-chip-text x={0} y={4.5} textAnchor="middle" className="fill-lamp-ink" style={{ font: "700 12.5px var(--mono)" }} />
      </g>
    </svg>
  );
});
