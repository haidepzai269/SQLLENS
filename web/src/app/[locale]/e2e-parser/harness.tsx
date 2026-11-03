"use client";

import { useEffect } from "react";
import { disposeParser, parseSql } from "@/modules/sql-intake/parser";

export function Harness() {
  useEffect(() => {
    Object.assign(window, { parseSql, disposeParser });
  }, []);
  return null;
}
