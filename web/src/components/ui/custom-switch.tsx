"use client";

import React, { useId, useState } from "react";
import styles from "./custom-switch.module.css";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

export const CustomSwitch: React.FC<SwitchProps> = ({
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  id: customId,
  name,
  "aria-label": ariaLabel,
  className,
}) => {
  const generatedId = useId();
  const id = customId ?? generatedId;
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
  const isChecked = isControlled ? Boolean(checked) : internalChecked;

  const handleToggle = (nextChecked: boolean) => {
    if (disabled) return;
    if (!isControlled) {
      setInternalChecked(nextChecked);
    }
    onChange?.(nextChecked);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleToggle(!isChecked);
    }
  };

  return (
    <div className={`inline-flex items-center align-middle ${styles.wrapper} ${className ?? ""}`.trim()}>
      <label
        htmlFor={id}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        className={`inline-block relative select-none cursor-pointer outline-none w-[46px] h-[24px] ${
          disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
        } ${styles.switch} ${disabled ? styles.disabled : ""}`.trim()}
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          aria-checked={isChecked}
          aria-disabled={disabled}
          aria-label={ariaLabel}
          checked={isChecked}
          disabled={disabled}
          onChange={(e) => handleToggle(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`relative flex items-center box-border w-[46px] h-[24px] rounded-full transition-all duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)] ${styles.slider}`}
          style={{
            backgroundColor: isChecked ? "rgb(0, 218, 80)" : "rgb(131, 131, 131)",
          }}
          aria-hidden="true"
        >
          {/* Effect line */}
          <div
            className="absolute rounded-[1px] transition-all duration-200 ease-in-out"
            style={{
              width: "9px",
              height: "3.5px",
              backgroundColor: "#fff",
              left: isChecked ? "29.5px" : "7.5px",
            }}
          />
          {/* Circle knob */}
          <div
            className={`absolute flex items-center justify-center rounded-full bg-white z-10 transition-all duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)] ${styles.circle}`}
            style={{
              width: "18px",
              height: "18px",
              left: isChecked ? "25px" : "3px",
              boxShadow: isChecked
                ? "-1px 1px 2px rgba(163, 163, 163, 0.45)"
                : "1px 1px 2px rgba(146, 146, 146, 0.45)",
            }}
          >
            <svg
              data-testid="cross-icon"
              className={`absolute transition-transform duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)] ${styles.cross}`}
              xmlSpace="preserve"
              style={{
                width: "6px",
                height: "6px",
                color: "rgb(131, 131, 131)",
                transform: isChecked ? "scale(0)" : "scale(1)",
                enableBackground: "new 0 0 512 512",
              } as React.CSSProperties}
              viewBox="0 0 365.696 365.696"
              y={0}
              x={0}
              xmlnsXlink="http://www.w3.org/1999/xlink"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <g>
                <path
                  data-original="#000000"
                  fill="currentColor"
                  d="M243.188 182.86 356.32 69.726c12.5-12.5 12.5-32.766 0-45.247L341.238 9.398c-12.504-12.503-32.77-12.503-45.25 0L182.86 122.528 69.727 9.374c-12.5-12.5-32.766-12.5-45.247 0L9.375 24.457c-12.5 12.504-12.5 32.77 0 45.25l113.152 113.152L9.398 295.99c-12.503 12.503-12.503 32.769 0 45.25L24.48 356.32c12.5 12.5 32.766 12.5 45.247 0l113.132-113.132L295.99 356.32c12.503 12.5 32.769 12.5 45.25 0l15.081-15.082c12.5-12.504 12.5-32.77 0-45.25zm0 0"
                />
              </g>
            </svg>
            <svg
              data-testid="checkmark-icon"
              className={`absolute transition-transform duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)] ${styles.checkmark}`}
              xmlSpace="preserve"
              style={{
                width: "10px",
                height: "10px",
                color: "rgb(0, 218, 80)",
                transform: isChecked ? "scale(1)" : "scale(0)",
                enableBackground: "new 0 0 512 512",
              } as React.CSSProperties}
              viewBox="0 0 24 24"
              y={0}
              x={0}
              xmlnsXlink="http://www.w3.org/1999/xlink"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <g>
                <path
                  className=""
                  data-original="#000000"
                  fill="currentColor"
                  d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"
                />
              </g>
            </svg>
          </div>
        </div>
      </label>
    </div>
  );
};

export const Switch = CustomSwitch;
export default CustomSwitch;
