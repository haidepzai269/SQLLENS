import { describe, expect, it } from "vitest";
import { retarget, SCRATCH } from "./measure-level";

describe("retarget", () => {
  it("đổi tên bảng trong câu thăm dò, không đụng tên cột chứa tên bảng", () => {
    expect(retarget("SELECT * FROM accounts a WHERE accounts_id = 1 AND a.x = 2", "accounts")).toBe(`SELECT * FROM "${SCRATCH}" a WHERE accounts_id = 1 AND a.x = 2`);
    expect(retarget('SELECT 1 FROM public."Orders" JOIN Orders2 USING (id)', "Orders")).toBe(`SELECT 1 FROM public."${SCRATCH}" JOIN Orders2 USING (id)`);
  });
});
