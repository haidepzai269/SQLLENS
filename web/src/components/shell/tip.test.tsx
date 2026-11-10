import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Tip } from "./tip";

afterEach(cleanup);

test("Tip renders trigger element", () => {
  render(
    <Tip label="Sample tip">
      <button type="button">Trigger</button>
    </Tip>,
  );
  expect(screen.getByRole("button", { name: "Trigger" })).toBeTruthy();
});

test("Tip displays content when open=true", () => {
  render(
    <Tip label="Ấn để chạy" open={true}>
      <button type="button">Play</button>
    </Tip>,
  );
  expect(screen.getByText("Ấn để chạy")).toBeTruthy();
});
