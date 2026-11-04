import { describe, expect, it } from "vitest";
import type { MentorStreamEvent } from "@/contracts/mentor";
import { readEvents } from "./stream";

const body = (chunks: string[]) => {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });
};
const all = async (chunks: string[]) => {
  const out: MentorStreamEvent[] = [];
  for await (const e of readEvents(body(chunks))) out.push(e);
  return out;
};

describe("readEvents", () => {
  it("ghép dòng bị cắt giữa chừng, CRLF và dòng cuối không có xuống dòng", async () => {
    expect(await all(['data: {"type":"del', 'ta","text":"a"}\r\ndata: {"type":"done"}'])).toEqual([
      { type: "delta", text: "a" },
      { type: "done" },
    ]);
  });
  it("bỏ qua sự kiện lạ, JSON hỏng và delta không có text", async () => {
    expect(await all(['data: {"type":"x"}\ndata: {oops\ndata: {"type":"delta"}\n: ping\ndata: {"type":"error","messageKey":"error.internal"}\n'])).toEqual([
      { type: "error", messageKey: "error.internal" },
    ]);
  });
  it("dòng quá dài thì ném lỗi", async () => {
    await expect(all(["data: " + "x".repeat(200_000)])).rejects.toThrow("line_too_long");
  });
});
