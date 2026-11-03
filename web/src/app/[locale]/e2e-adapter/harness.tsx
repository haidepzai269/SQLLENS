"use client";

import { useEffect } from "react";
import { createPostgresAdapter } from "@/engines/postgres/adapter";

export function Harness() {
  useEffect(() => {
    (window as unknown as { createPostgresAdapter: unknown }).createPostgresAdapter = createPostgresAdapter;
  }, []);
  return null;
}
