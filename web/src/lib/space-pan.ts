"use client";

import { useEffect, useState } from "react";

/**
 * Hook phát hiện người dùng đang giữ phím Space để chuyển con trỏ chuột sang grab / grabbing khi kéo pan canvas.
 */
export function useSpacePan() {
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }
        setIsSpaceDown(true);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        setIsSpaceDown(false);
        setIsDragging(false);
      }
    }

    function onBlur() {
      setIsSpaceDown(false);
      setIsDragging(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return {
    isSpaceDown,
    isDragging,
    setIsDragging,
    panClassName: isSpaceDown ? `space-panning ${isDragging ? "is-dragging" : ""}` : "",
  };
}
