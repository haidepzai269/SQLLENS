import { describe, expect, it } from "vitest";
import en from "../../../../messages/en/conflictSim.json";
import vi from "../../../../messages/vi/conflictSim.json";
import { cfgFor, GUARDS, ISOLATIONS, SCENARIO_IDS, sessionState, simulateCfg, waitEdges, type Cfg } from "./model";

const BAD = /thiết kế (này )?(đã )?ổn|design is (fine|ok|good)|good design|safe/i;
const get = (o: unknown, key: string) => key.split(".").slice(1).reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

const ALL: Cfg[] = SCENARIO_IDS.flatMap((id) =>
  ISOLATIONS.flatMap((isolation) => (id === "double_booking" ? GUARDS : (["none"] as const)).map((guard) => ({ id, isolation, guard }))),
);

describe("conflict-sim ui", () => {
  it("every key the engine can emit has text in vi and en", () => {
    const keys = new Set<string>();
    for (const c of ALL) {
      const r = simulateCfg(c);
      if (r.kind === "not_simulated") keys.add(r.reasonKey);
      else {
        r.data.ticks.forEach((t) => keys.add(t.messageKey));
        r.evidence.forEach((e) => keys.add(e.messageKey));
      }
    }
    for (const k of keys) for (const l of [vi, en]) expect(get(l, k), k).toEqual(expect.any(String));
  });

  it("outcome sentences never say the design is fine and always name the scenario scope", () => {
    for (const l of [vi, en]) {
      const o = Object.values(l.outcome);
      expect(o).toHaveLength(4);
      o.forEach((s) => expect(s).not.toMatch(BAD));
    }
    expect(vi.outcome.not_broken).toMatch(/kịch bản này ở mức cô lập này/);
    expect(en.outcome.not_broken).toMatch(/this scenario at this isolation level/);
  });

  it("deadlock shows a cycle at the second wait and none after rewinding", () => {
    const r = simulateCfg(cfgFor("deadlock_reverse_order"));
    if (r.kind !== "conclusion") throw new Error("not simulated");
    const ticks = r.data.ticks;
    const p = ticks.findIndex((t) => t.waiting.length === 2) + 1;
    expect(p).toBeGreaterThan(0);
    const g = waitEdges(ticks, p);
    expect(g.cycle).toBe(true);
    expect(g.edges.map((e) => `${e.session}>${e.holder}`).sort()).toEqual(["A>B", "B>A"]);
    expect(waitEdges(ticks, p - 1).cycle).toBe(false);
    expect(sessionState(ticks, p, "A")).toBe("waiting");
    expect(sessionState(ticks, ticks.length, "A")).not.toBe("waiting");
  });

  it("lost update waits without a cycle and both sessions end committed or rolled back", () => {
    const r = simulateCfg(cfgFor("lost_update"));
    if (r.kind !== "conclusion") throw new Error("not simulated");
    const w = r.data.ticks.findIndex((t) => t.waiting.length === 1) + 1;
    expect(waitEdges(r.data.ticks, w)).toMatchObject({ cycle: false, edges: [{ session: "B", holder: "A" }] });
    expect(sessionState(r.data.ticks, r.data.ticks.length, "A")).toBe("committed");
    expect(sessionState(r.data.ticks, 0, "A")).toBe("idle");
  });
});
