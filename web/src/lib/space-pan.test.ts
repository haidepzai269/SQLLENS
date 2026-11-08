import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpacePan } from "./space-pan";

describe("useSpacePan", () => {
  it("bật panClassName khi nhấn Space và tắt khi thả Space", () => {
    const { result } = renderHook(() => useSpacePan());

    expect(result.current.isSpaceDown).toBe(false);
    expect(result.current.panClassName).toBe("");

    // Nhấn phím Space
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    });

    expect(result.current.isSpaceDown).toBe(true);
    expect(result.current.panClassName).toContain("space-panning");

    // Thả phím Space
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    });

    expect(result.current.isSpaceDown).toBe(false);
    expect(result.current.panClassName).toBe("");
  });

  it("không kích hoạt khi focus vào input hoặc textarea", () => {
    const { result } = renderHook(() => useSpacePan());

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    });

    expect(result.current.isSpaceDown).toBe(false);
    expect(result.current.panClassName).toBe("");

    document.body.removeChild(input);
  });
});
