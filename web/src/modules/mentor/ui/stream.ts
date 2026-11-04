import type { MentorStreamEvent } from "@/contracts/mentor";

const MAX_LINE = 128 * 1024;

// Đọc SSE của /api/ai/chat: mỗi dòng `data: <JSON>`. Sự kiện lạ hoặc JSON hỏng bị bỏ qua (không tin server), dòng quá dài thì ném lỗi.
export function parseLine(line: string): MentorStreamEvent | null {
  if (!line.startsWith("data:")) return null;
  try {
    const v = JSON.parse(line.slice(5)) as Record<string, unknown> | null;
    if (v?.type === "delta" && typeof v.text === "string") return { type: "delta", text: v.text };
    if (v?.type === "done") return { type: "done" };
    if (v?.type === "error" && typeof v.messageKey === "string") return { type: "error", messageKey: v.messageKey };
  } catch {
    /* dòng không phải JSON */
  }
  return null;
}

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<MentorStreamEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += dec.decode(value, { stream: !done });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const ev = parseLine(buf.slice(0, i).replace(/\r$/, ""));
        buf = buf.slice(i + 1);
        if (ev) yield ev;
      }
      if (buf.length > MAX_LINE) throw new Error("line_too_long");
      if (done) {
        const ev = parseLine(buf.replace(/\r$/, ""));
        if (ev) yield ev;
        return;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
