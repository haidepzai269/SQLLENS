import { describe, expect, it } from "vitest";
import { isBlockedE2eRoute as f } from "./e2e-route-guard";

describe("isBlockedE2eRoute", () => {
  it.each(["/vi/e2e-mentor", "/en/e2e-btree-anim", "/VI/E2E-Mentor", "/vi/e2e-mentor/", "/vi/e2e-", "/vi/e2e-x/sub", "//vi//e2e-x", "/vi/e%32e-mentor"])("production chặn %s", (p) => {
    expect(f(p, "production")).toBe(true);
  });
  it.each(["/vi", "/vi/", "/vi/about", "/en/login", "/vi/e2e", "/vi/xe2e-a", "/e2e-mentor", "/fr/e2e-mentor", "/vi/lab/e2e-x", "/vi/%E0%A4%A"])("production cho qua %s", (p) => {
    expect(f(p, "production")).toBe(false);
  });
  it.each([undefined, "preview", "development", ""])("VERCEL_ENV=%s cho qua", (env) => {
    expect(f("/vi/e2e-mentor", env)).toBe(false);
  });
});
