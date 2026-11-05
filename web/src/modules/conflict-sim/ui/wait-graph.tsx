"use client";

import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import type { WaitInfo } from "../engine/types";

// Cytoscape wants plain colours: resolve a CSS value (maybe oklch) to rgb through a 1px canvas.
function rgb(host: HTMLElement, value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  host.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return `rgb(${r},${g},${b})`;
}

export default function WaitGraph({ edges, cycle, label }: { edges: WaitInfo[]; cycle: boolean; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    const host = box.current!;
    const text = rgb(host, "var(--text)");
    const bad = rgb(host, "var(--severity-broken)");
    const g = cytoscape({
      container: host,
      elements: [{ data: { id: "A", label: "A" } }, { data: { id: "B", label: "B" } }],
      userZoomingEnabled: false, userPanningEnabled: false, boxSelectionEnabled: false, autoungrabify: true,
      style: [
        { selector: "node", style: { label: "data(label)", color: text, "text-valign": "center", "background-color": rgb(host, "var(--surface)"), "border-width": 2, "border-color": rgb(host, "var(--line)"), width: 36, height: 36, "font-size": 14 } },
        { selector: "edge", style: { "curve-style": "bezier", "line-color": text, "target-arrow-color": text, "target-arrow-shape": "triangle", width: 2 } },
        { selector: "edge.cycle", style: { "line-color": bad, "target-arrow-color": bad, width: 3 } },
      ],
    });
    const place = () => {
      g.resize();
      g.getElementById("A").position({ x: g.width() * 0.25, y: g.height() / 2 });
      g.getElementById("B").position({ x: g.width() * 0.75, y: g.height() / 2 });
    };
    place();
    const ro = new ResizeObserver(place); // window or panel resize keeps the nodes centred
    ro.observe(host);
    cy.current = g;
    return () => { ro.disconnect(); g.destroy(); cy.current = null; };
  }, []);

  useEffect(() => {
    const g = cy.current;
    if (!g) return;
    g.edges().remove();
    g.add(edges.map((e) => ({ data: { id: `${e.session}>${e.holder}`, source: e.session, target: e.holder }, classes: cycle ? "cycle" : "" })));
  }, [edges, cycle]);

  return <div ref={box} role="img" aria-label={label} className="h-36 w-full border border-line bg-ground" data-testid="wait-graph" />;
}
