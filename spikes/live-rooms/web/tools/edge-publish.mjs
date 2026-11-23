// Ca biên phía PHÁT: khi snapshot vượt trần 32 KB hoặc vượt 100 tab thì chuyện gì xảy ra
// ở server fan-out. AC1 đã đo `encodeSnapshot` chặn trong trình duyệt; ở đây hỏi câu khác:
// nếu ai đó bỏ qua codec (hoặc một client khác gọi thẳng) thì Gin có chặn không.
//
// Chạy: node tools/edge-publish.mjs
import { save, API, WEB, launch, sleep } from "./lib.mjs";

const room = `edge-pub-${Date.now()}`;

async function post(bytes, note) {
  const payload = "g." + "A".repeat(bytes);
  const res = await fetch(`${API}/room/${room}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 0, payload, sqlBytes: 0, bytes: payload.length, hasPlan: false, rows: 0 }),
  });
  const text = await res.text();
  return { note, payloadBytes: payload.length, status: res.status, body: text.slice(0, 200) };
}

const cases = [];
// 32 KB là trần của codec SP022, không phải trần của server fan-out.
cases.push(await post(32 * 1024, "đúng 32 KB (trần codec)"));
cases.push(await post(32 * 1024 + 1, "32 KB + 1 B"));
cases.push(await post(1024 * 1024, "1 MB"));
cases.push(await post(3 * 1024 * 1024, "3 MB"));
cases.push(await post(5 * 1024 * 1024, "5 MB (trần server 4 MB)"));

// 101 tab: server fan-out không biết gì về số tab, payload là chuỗi mờ.
const tabs101 = { v: 1, project: { name: "x", engine: "postgres" }, tabs: Array.from({ length: 101 }, (_, i) => ({ name: `t${i}`, sql: "SELECT 1;" })) };
const resTabs = await fetch(`${API}/room/${room}/publish`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ v: 0, payload: JSON.stringify(tabs101), sqlBytes: 0, bytes: 100, hasPlan: false, rows: 0 }),
});
cases.push({ note: "101 tab gửi thẳng JSON (không qua codec)", status: resTabs.status, body: (await resTabs.text()).slice(0, 200) });

save("edge_publish.json", { room, cases });
for (const c of cases) console.log(`${c.note}: status=${c.status} ${c.body ?? ""}`);
