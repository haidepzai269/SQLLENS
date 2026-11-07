import { describe, expect, it } from "vitest";
import { providerNext, safeNext } from "./next";

describe("safeNext", () => {
  it("giữ đường dẫn nội bộ có query", () => {
    expect(safeNext("/vi?engine=postgres", "vi")).toBe("/vi?engine=postgres");
    expect(safeNext("/en/about#top", "en")).toBe("/en/about#top");
  });
  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "evil", "", "/a\nb"])(
    "từ chối %j",
    (x) => expect(safeNext(x, "vi")).toBe("/vi"),
  );
  it("rỗng, null, undefined về trang chủ theo ngôn ngữ", () => {
    expect(safeNext(null, "en")).toBe("/en");
    expect(safeNext(undefined, "vi")).toBe("/vi");
  });
  it("không quay về chính trang đăng nhập, bỏ auth_error", () => {
    expect(safeNext("/vi/login?next=/x", "vi")).toBe("/vi");
    expect(safeNext("/vi?auth_error=failed&engine=postgres", "vi")).toBe("/vi?engine=postgres");
  });
});

describe("providerNext", () => {
  it("bọc next trong trang đăng nhập", () => {
    expect(providerNext("/vi?engine=postgres", "vi")).toBe("/vi/login?next=%2Fvi%3Fengine%3Dpostgres");
  });
  it("quá dài thì dùng next thẳng", () => {
    const long = "/vi?q=" + "a".repeat(480);
    expect(providerNext(long, "vi")).toBe(long);
  });
});
