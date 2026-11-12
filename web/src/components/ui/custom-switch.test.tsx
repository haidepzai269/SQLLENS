import React, { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CustomSwitch, Switch } from "./custom-switch";

describe("CustomSwitch Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("render đúng switch với vai trò role switch và aria-checked mặc định là false", () => {
    render(<CustomSwitch aria-label="Toggle setting" />);
    const switchEl = screen.getByRole("switch", { name: "Toggle setting" }) as HTMLInputElement;
    expect(switchEl).toBeDefined();
    expect(switchEl.checked).toBe(false);
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  it("Switch alias tương thích 100% với CustomSwitch", () => {
    expect(Switch).toBe(CustomSwitch);
  });

  it("render đúng khi checked={true} hoặc defaultChecked={true}", () => {
    const { unmount } = render(<CustomSwitch defaultChecked aria-label="Default checked" />);
    let switchEl = screen.getByRole("switch", { name: "Default checked" }) as HTMLInputElement;
    expect(switchEl.checked).toBe(true);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
    unmount();

    render(<CustomSwitch checked aria-label="Controlled checked" onChange={() => {}} />);
    switchEl = screen.getByRole("switch", { name: "Controlled checked" }) as HTMLInputElement;
    expect(switchEl.checked).toBe(true);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("hiển thị đầy đủ cả SVG Cross và Checkmark trong slider circle", () => {
    render(<CustomSwitch id="test-switch" />);
    const crossSvg = screen.getByTestId("cross-icon");
    const checkmarkSvg = screen.getByTestId("checkmark-icon");

    expect(crossSvg).toBeDefined();
    expect(checkmarkSvg).toBeDefined();
    expect(crossSvg.getAttribute("viewBox")).toBe("0 0 365.696 365.696");
    expect(checkmarkSvg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("chế độ Uncontrolled: toggle khi click và gọi onChange", () => {
    const handleChange = vi.fn();
    render(<CustomSwitch aria-label="Uncontrolled switch" onChange={handleChange} />);
    const switchEl = screen.getByRole("switch", { name: "Uncontrolled switch" }) as HTMLInputElement;

    expect(switchEl.checked).toBe(false);

    fireEvent.click(switchEl);
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(true);
    expect(switchEl.checked).toBe(true);

    fireEvent.click(switchEl);
    expect(handleChange).toHaveBeenCalledTimes(2);
    expect(handleChange).toHaveBeenCalledWith(false);
    expect(switchEl.checked).toBe(false);
  });

  it("chế độ Controlled: tuân thủ state bên ngoài", () => {
    const ControlledTestComponent = () => {
      const [val, setVal] = useState(false);
      return (
        <CustomSwitch
          aria-label="Controlled component"
          checked={val}
          onChange={(next) => setVal(next)}
        />
      );
    };

    render(<ControlledTestComponent />);
    const switchEl = screen.getByRole("switch", { name: "Controlled component" }) as HTMLInputElement;
    expect(switchEl.checked).toBe(false);

    fireEvent.click(switchEl);
    expect(switchEl.checked).toBe(true);

    fireEvent.click(switchEl);
    expect(switchEl.checked).toBe(false);
  });

  it("điều khiển bằng bàn phím: bấm phím Space để toggle", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <CustomSwitch aria-label="Keyboard switch" onChange={handleChange} />
    );
    const label = container.querySelector("label");
    expect(label).not.toBeNull();

    fireEvent.keyDown(label!, { key: " " });
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("điều khiển bằng bàn phím: bấm phím Enter để toggle", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <CustomSwitch aria-label="Keyboard switch Enter" onChange={handleChange} />
    );
    const label = container.querySelector("label");
    expect(label).not.toBeNull();

    fireEvent.keyDown(label!, { key: "Enter" });
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("trạng thái disabled: không kích hoạt toggle bằng click hoặc bàn phím", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <CustomSwitch disabled aria-label="Disabled switch" onChange={handleChange} />
    );
    const switchEl = screen.getByRole("switch", { name: "Disabled switch" }) as HTMLInputElement;
    const label = container.querySelector("label");

    expect(switchEl.disabled).toBe(true);
    expect(switchEl.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(switchEl);
    expect(handleChange).not.toHaveBeenCalled();

    fireEvent.keyDown(label!, { key: " " });
    expect(handleChange).not.toHaveBeenCalled();

    fireEvent.keyDown(label!, { key: "Enter" });
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("gán đúng các props id, name, className", () => {
    const { container } = render(
      <CustomSwitch id="custom-id" name="setting_key" className="extra-class" />
    );
    const wrapper = container.firstChild as HTMLElement;
    const input = container.querySelector("#custom-id") as HTMLInputElement;

    expect(wrapper.classList.contains("extra-class")).toBe(true);
    expect(input).not.toBeNull();
    expect(input.name).toBe("setting_key");
  });
});
