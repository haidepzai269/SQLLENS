import type { ArenaScenarioStep, ArenaTxStatus } from "../types";

export type ArenaGraphNodeData = {
  id: "A" | "B";
  label: string;
  status: ArenaTxStatus;
};

export type ArenaGraphEdgeData = {
  id: string;
  source: "A" | "B";
  target: "A" | "B";
};

export type ArenaGraphElement =
  | { data: ArenaGraphNodeData; classes: string }
  | { data: ArenaGraphEdgeData; classes: string };

/**
 * Kẹp chỉ số bước vào khoảng hợp lệ `0..totalSteps-1` để không bao giờ vỡ đồ thị.
 */
export function clampArenaStepIndex(stepIndex: number, totalSteps: number): number {
  if (!Number.isFinite(totalSteps) || totalSteps <= 0) {
    return 0;
  }
  const maxStep = Math.floor(totalSteps) - 1;
  if (!Number.isFinite(stepIndex)) {
    return 0;
  }
  return Math.max(0, Math.min(maxStep, Math.floor(stepIndex)));
}

function nodeClasses(status: ArenaTxStatus, deadlockDetected?: boolean): string {
  const classes = [`status-${status}`];
  if (deadlockDetected && (status === "aborted" || status === "waiting")) {
    classes.push("deadlocked");
  }
  return classes.join(" ");
}

/**
 * Chuyển đổi một bước `ArenaScenarioStep` thành danh sách node (`A`, `B`) và edge Wait-For cho Cytoscape.
 */
export function buildArenaGraphElements(step: ArenaScenarioStep): {
  nodes: { data: ArenaGraphNodeData; classes: string }[];
  edges: { data: ArenaGraphEdgeData; classes: string }[];
} {
  const txA = step.transactions.A;
  const txB = step.transactions.B;
  const isDeadlock = Boolean(step.deadlockDetected);

  const nodes: { data: ArenaGraphNodeData; classes: string }[] = [
    {
      data: { id: "A", label: "Tx A", status: txA.status },
      classes: nodeClasses(txA.status, isDeadlock),
    },
    {
      data: { id: "B", label: "Tx B", status: txB.status },
      classes: nodeClasses(txB.status, isDeadlock),
    },
  ];

  const edges: { data: ArenaGraphEdgeData; classes: string }[] = [];

  if (isDeadlock) {
    edges.push(
      { data: { id: "A>B", source: "A", target: "B" }, classes: "cycle" },
      { data: { id: "B>A", source: "B", target: "A" }, classes: "cycle" },
    );
  } else {
    if (txA.status === "waiting" && txB.status !== "aborted") {
      edges.push({ data: { id: "A>B", source: "A", target: "B" }, classes: "waiting" });
    }
    if (txB.status === "waiting" && txA.status !== "aborted") {
      edges.push({ data: { id: "B>A", source: "B", target: "A" }, classes: "waiting" });
    }
  }

  return { nodes, edges };
}

/**
 * Dựng phần tử đồ thị từ danh sách bước của kịch bản, tự động kẹp chỉ số nếu ngoài biên.
 */
export function buildArenaGraphFromScenario(
  steps: ArenaScenarioStep[],
  stepIndex: number,
): {
  nodes: { data: ArenaGraphNodeData; classes: string }[];
  edges: { data: ArenaGraphEdgeData; classes: string }[];
} {
  if (steps.length === 0) {
    return { nodes: [], edges: [] };
  }
  const safeIndex = clampArenaStepIndex(stepIndex, steps.length);
  return buildArenaGraphElements(steps[safeIndex]);
}
