import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { EngineAdapter } from "@/contracts/engine";
import btree from "../../../../messages/en/btree.json";
import capacity from "../../../../messages/en/capacity.json";
import capacityUi from "../../../../messages/en/capacityUi.json";
import { CapacityPanel } from "./capacity-panel";

// Thay phần chạm vào PGlite: mẫu đo giả có một tầng (chưa có internal) để vào nhánh NotSimulated của estimateCapacity.
vi.mock("./measure-level", async (orig) => ({
  ...(await orig<typeof import("./measure-level")>()),
  checkTarget: async () => ({ kind: "conclusion", label: "real", data: {}, evidence: [{ kind: "x", messageKey: "x" }] }),
  measureLevel: async () => ({
    kind: "conclusion",
    label: "real",
    data: { sample: { index: "ix", table: "t", rows: 10_000, height: 1, indexPages: 3, leafPages: 2, leafFanout: 5000 } },
    evidence: [{ kind: "x", messageKey: "x" }],
  }),
}));

afterEach(cleanup);
const wrap = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ btree, capacity, capacityUi }}>
      <CapacityPanel adapter={{} as EngineAdapter} index="ix" table="t" />
    </NextIntlClientProvider>,
  );

describe("CapacityPanel", () => {
  test("AC4: mẫu chưa có internal thì hiện lý do, không hiện số 0", async () => {
    wrap();
    await waitFor(() => expect((screen.getByTestId("level-measure-10000") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("level-measure-10000"));
    await waitFor(() => expect(screen.getByTestId("capacity-height").textContent).toBe("1"));
    expect(screen.getByTestId("capacity-label").dataset.label).toBe("real");
    fireEvent.change(screen.getByTestId("capacity-slider"), { target: { value: "3" } }); // 1.000.000 dòng
    expect(screen.getByTestId("capacity-label").dataset.label).toBe("estimated");
    expect(screen.getByTestId("capacity-reason").textContent).toContain("Use a larger sample");
    expect(screen.queryByTestId("capacity-height")).toBeNull();
    expect(screen.queryByTestId("capacity-size")).toBeNull();
  });

  test("chưa đo mốc nào: kéo qua 500k không ra số", () => {
    wrap();
    fireEvent.change(screen.getByTestId("capacity-slider"), { target: { value: "4" } });
    expect(screen.getByTestId("capacity-label").dataset.label).toBe("estimated");
    expect(screen.getByTestId("capacity-reason").textContent).toContain("measure at least one real point");
    expect(screen.queryByTestId("capacity-height")).toBeNull();
  });
});
