import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import arenaEn from "../../../../messages/en/arena.json";
import arenaVi from "../../../../messages/vi/arena.json";
import commonEn from "../../../../messages/en/common.json";
import commonVi from "../../../../messages/vi/common.json";
import type { ArenaScenarioStep } from "../types";
import { ArenaWaitGraph } from "./arena-wait-graph";
import {
  buildArenaGraphElements,
  buildArenaGraphFromScenario,
  clampArenaStepIndex,
} from "./graph-elements";

afterEach(cleanup);

function makeStep(overrides: Partial<ArenaScenarioStep> = {}): ArenaScenarioStep {
  return {
    stepIndex: 0,
    titleKey: "steps.deadlock_reverse_order.step0.title",
    descriptionKey: "steps.deadlock_reverse_order.step0.description",
    transactions: {
      A: { session: "A", sql: "BEGIN", status: "idle" },
      B: { session: "B", sql: "BEGIN", status: "idle" },
    },
    ...overrides,
  };
}

function renderGraph(step: ArenaScenarioStep, locale: "vi" | "en" = "vi") {
  const messages = {
    arena: locale === "vi" ? arenaVi : arenaEn,
    common: locale === "vi" ? commonVi : commonEn,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ArenaWaitGraph step={step} />
    </NextIntlClientProvider>,
  );
}

describe("graph-elements", () => {
  it("AC1: map đủ 4 nhóm trạng thái màu/class node (active, waiting, aborted, committed/idle)", () => {
    const activeWaiting = buildArenaGraphElements(
      makeStep({
        transactions: {
          A: { session: "A", sql: "UPDATE ...", status: "active" },
          B: { session: "B", sql: "UPDATE ...", status: "waiting" },
        },
      }),
    );

    expect(activeWaiting.nodes.find((n) => n.data.id === "A")?.classes).toContain("status-active");
    expect(activeWaiting.nodes.find((n) => n.data.id === "B")?.classes).toContain("status-waiting");
    expect(activeWaiting.edges).toEqual([
      { data: { id: "B>A", source: "B", target: "A" }, classes: "waiting" },
    ]);

    const abortedCommitted = buildArenaGraphElements(
      makeStep({
        transactions: {
          A: { session: "A", sql: "COMMIT", status: "aborted" },
          B: { session: "B", sql: "COMMIT", status: "committed" },
        },
      }),
    );

    expect(abortedCommitted.nodes.find((n) => n.data.id === "A")?.classes).toContain("status-aborted");
    expect(abortedCommitted.nodes.find((n) => n.data.id === "B")?.classes).toContain("status-committed");
    expect(abortedCommitted.edges).toEqual([]);

    const idleStep = buildArenaGraphElements(makeStep());
    expect(idleStep.nodes.find((n) => n.data.id === "A")?.classes).toContain("status-idle");
    expect(idleStep.nodes.find((n) => n.data.id === "B")?.classes).toContain("status-idle");
  });

  it("AC1: deadlockDetected=true tạo chu trình edge cycle hai chiều A->B và B->A", () => {
    const deadlock = buildArenaGraphElements(
      makeStep({
        deadlockDetected: true,
        transactions: {
          A: { session: "A", sql: "UPDATE ...", status: "aborted" },
          B: { session: "B", sql: "UPDATE ...", status: "waiting" },
        },
      }),
    );

    expect(deadlock.edges).toHaveLength(2);
    expect(deadlock.edges.every((e) => e.classes === "cycle")).toBe(true);
    expect(deadlock.edges.map((e) => e.data.id)).toEqual(["A>B", "B>A"]);
    expect(deadlock.nodes.find((n) => n.data.id === "A")?.classes).toContain("deadlocked");
    expect(deadlock.nodes.find((n) => n.data.id === "B")?.classes).toContain("deadlocked");
  });

  it("Ca biên: kẹp bước an toàn khi ngoài phạm vi 0..totalSteps-1", () => {
    expect(clampArenaStepIndex(-3, 5)).toBe(0);
    expect(clampArenaStepIndex(99, 5)).toBe(4);
    expect(clampArenaStepIndex(Number.NaN, 5)).toBe(0);

    const steps = [
      makeStep({ stepIndex: 0 }),
      makeStep({
        stepIndex: 1,
        transactions: {
          A: { session: "A", sql: "BEGIN", status: "active" },
          B: { session: "B", sql: "BEGIN", status: "committed" },
        },
      }),
    ];

    const outOfBounds = buildArenaGraphFromScenario(steps, 99);
    expect(outOfBounds.nodes.find((n) => n.data.id === "B")?.classes).toContain("status-committed");
  });
});

describe("ArenaWaitGraph", () => {
  it("render Cytoscape Wait-For Graph không lỗi và dọn sạch khi unmount", () => {
    const step = makeStep({
      deadlockDetected: true,
      transactions: {
        A: { session: "A", sql: "UPDATE accounts ...", status: "aborted" },
        B: { session: "B", sql: "UPDATE accounts ...", status: "waiting" },
      },
    });

    const { unmount } = renderGraph(step, "vi");
    const el = screen.getByTestId("arena-wait-graph");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-deadlock")).toBe("true");
    expect(el.getAttribute("data-edges")).toBe("2");
    expect(el.getAttribute("data-status-a")).toBe("aborted");
    expect(el.getAttribute("data-status-b")).toBe("waiting");

    expect(() => unmount()).not.toThrow();
  });
});
