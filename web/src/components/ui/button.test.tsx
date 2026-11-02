import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

test("Button renders its label as a button", () => {
  render(<Button>Run</Button>);
  expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
});
