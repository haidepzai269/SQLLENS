"use client";

import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { ArenaScenarioStep } from "../types";
import { buildArenaGraphElements } from "./graph-elements";

export interface ArenaWaitGraphProps {
  step: ArenaScenarioStep;
  className?: string;
  testId?: string;
}

// Cytoscape cần màu rgb() thuần: resolve CSS variable (kể cả oklch) qua canvas 1x1.
function resolveRgb(host: HTMLElement, value: string, fallback: string): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = value;
    host.appendChild(probe);
    const css = getComputedStyle(probe).color;
    probe.remove();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return css || fallback;
    }
    ctx.fillStyle = css || fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  } catch {
    return fallback;
  }
}

export function ArenaWaitGraph({
  step,
  className,
  testId = "arena-wait-graph",
}: ArenaWaitGraphProps) {
  const t = useTranslations("arena");
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    const host = boxRef.current;
    if (!host) return;

    const text = resolveRgb(host, "var(--text)", "rgb(226,232,240)");
    const surface = resolveRgb(host, "var(--surface)", "rgb(30,41,59)");
    const line = resolveRgb(host, "var(--line)", "rgb(100,116,139)");
    const activeColor = resolveRgb(host, "var(--label-real)", "rgb(34,197,94)");
    const waitingColor = resolveRgb(host, "var(--severity-uncertain)", "rgb(234,179,8)");
    const abortedColor = resolveRgb(host, "var(--severity-broken)", "rgb(239,68,68)");
    const idleColor = resolveRgb(host, "var(--dim)", "rgb(148,163,184)");

    const hasCanvas2d = (() => {
      try {
        return Boolean(document.createElement("canvas").getContext("2d"));
      } catch {
        return false;
      }
    })();

    const g = cytoscape({
      ...(hasCanvas2d ? { container: host } : { headless: true }),
      elements: [
        { data: { id: "A", label: "Tx A" } },
        { data: { id: "B", label: "Tx B" } },
      ],
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            color: text,
            "text-valign": "center",
            "text-halign": "center",
            "background-color": surface,
            "border-width": 2.5,
            "border-color": line,
            width: 52,
            height: 52,
            "font-size": 12,
            "font-weight": "bold",
          },
        },
        {
          selector: "node.status-active",
          style: {
            "background-color": activeColor,
            "border-color": activeColor,
            color: "rgb(255,255,255)",
          },
        },
        {
          selector: "node.status-waiting",
          style: {
            "background-color": waitingColor,
            "border-color": waitingColor,
            color: "rgb(15,23,42)",
          },
        },
        {
          selector: "node.status-aborted, node.deadlocked",
          style: {
            "background-color": abortedColor,
            "border-color": abortedColor,
            color: "rgb(255,255,255)",
          },
        },
        {
          selector: "node.status-committed, node.status-idle",
          style: {
            "background-color": surface,
            "border-color": idleColor,
            color: text,
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "control-point-step-size": 36,
            "line-color": waitingColor,
            "target-arrow-color": waitingColor,
            "target-arrow-shape": "triangle",
            width: 2.5,
          },
        },
        {
          selector: "edge.cycle",
          style: {
            "line-color": abortedColor,
            "target-arrow-color": abortedColor,
            width: 3.5,
          },
        },
      ],
    });

    const place = () => {
      if (!hasCanvas2d) return;
      g.resize();
      const w = g.width();
      const h = g.height();
      if (w > 0 && h > 0) {
        g.getElementById("A").position({ x: w * 0.28, y: h / 2 });
        g.getElementById("B").position({ x: w * 0.72, y: h / 2 });
      }
    };
    place();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(host);
    cyRef.current = g;

    return () => {
      ro?.disconnect();
      g.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = cyRef.current;
    if (!g) return;

    const { nodes, edges } = buildArenaGraphElements(step);
    for (const n of nodes) {
      const el = g.getElementById(n.data.id);
      if (el.length > 0) {
        el.classes(n.classes);
      }
    }

    g.edges().remove();
    if (edges.length > 0) {
      g.add(edges);
    }

    const container = g.container();
    if (container) {
      container.dataset.edges = String(g.edges().length);
    }
  }, [step]);

  const { edges } = buildArenaGraphElements(step);

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-dim">
          {t("graph.title")}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-label-real" aria-hidden />
            {t("view.status.active")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-severity-uncertain" aria-hidden />
            {t("view.status.waiting")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-severity-broken" aria-hidden />
            {t("view.status.aborted")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-dim" aria-hidden />
            {t("view.status.idle")}
          </span>
        </div>
      </div>

      <div
        ref={boxRef}
        role="img"
        aria-label={t("graph.ariaLabel")}
        className="h-36 w-full rounded border border-line bg-ground sm:h-40"
        data-testid={testId}
        data-deadlock={String(Boolean(step.deadlockDetected))}
        data-edges={String(edges.length)}
        data-status-a={step.transactions.A.status}
        data-status-b={step.transactions.B.status}
      />
    </div>
  );
}
