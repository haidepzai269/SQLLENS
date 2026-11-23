"use client";

/**
 * Viewer của spike. KHÔNG phải giao diện sản phẩm.
 *
 * Nhiệm vụ: nối vào một phòng theo chế độ `sse` hoặc `poll`, đếm những gì nó nhận được
 * (số sự kiện, byte thân phản hồi), và ghi vào `window.__viewer` để Playwright đọc.
 *
 * Byte thật trên dây do proxy TCP đếm (tools/tcpcount.mjs), không phải trang này — trang
 * này chỉ đếm phần nó thấy, để đối chiếu hai con số với nhau.
 */

import { useEffect, useRef, useState } from "react";

type Mode = "sse" | "poll";

export default function ViewerPage() {
  const [mode, setMode] = useState<Mode>("sse");
  const [room, setRoom] = useState("r1");
  const [interval, setIntervalMs] = useState(2000);
  // `ready` chặn hiệu ứng nối mạng ở lần render đầu: nếu nối ngay, trang sẽ mở một kết nối
  // rác tới phòng mặc định "r1" rồi mới nối phòng thật, làm sai phép đếm request của AC2.
  const [ready, setReady] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const state = useRef({
    events: 0,
    bodyBytes: 0,
    polls: 0,
    notModified: 0,
    errors: 0,
    lastEventAt: 0,
    firstEventAt: 0,
    versions: [] as number[],
    payloadBytes: 0,
    sqlBytes: 0,
    startedAt: 0,
  });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setMode((q.get("mode") as Mode) ?? "sse");
    setRoom(q.get("room") ?? "r1");
    setIntervalMs(Number(q.get("interval") ?? 2000));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const s = state.current;
    s.startedAt = Date.now();
    (window as unknown as Record<string, unknown>).__viewer = s;
    let stop = false;
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let version = 0;

    const bump = () => {
      (window as unknown as Record<string, unknown>).__viewer = { ...s, mode, room, interval };
    };
    bump();

    const onSnapshot = (raw: string) => {
      s.events++;
      const now = Date.now();
      if (!s.firstEventAt) s.firstEventAt = now;
      s.lastEventAt = now;
      try {
        const o = JSON.parse(raw) as { v?: number; bytes?: number; sqlBytes?: number };
        s.versions.push(o.v ?? 0);
        s.payloadBytes = o.bytes ?? 0;
        s.sqlBytes = o.sqlBytes ?? 0;
      } catch {
        /* bỏ qua */
      }
      bump();
    };

    if (mode === "sse") {
      es = new EventSource(`/api/room/${room}/events`);
      es.addEventListener("snapshot", (e) => onSnapshot((e as MessageEvent<string>).data));
      es.addEventListener("hello", (e) => {
        s.events++;
        if (!s.firstEventAt) s.firstEventAt = Date.now();
        s.lastEventAt = Date.now();
        setLog((l) => [...l.slice(-5), `hello ${(e as MessageEvent<string>).data}`]);
        bump();
      });
      es.onerror = () => {
        s.errors++;
        bump();
      };
    } else {
      const tick = async () => {
        if (stop) return;
        try {
          const r = await fetch(`/api/room/${room}/poll?v=${version}`, { cache: "no-store" });
          s.polls++;
          if (r.status === 304 || r.status === 204) {
            s.notModified++;
            void (await r.text());
          } else {
            const text = await r.text();
            s.bodyBytes += new TextEncoder().encode(text).length;
            const o = JSON.parse(text) as { v?: number };
            version = o.v ?? version;
            onSnapshot(text);
          }
        } catch {
          s.errors++;
        }
        bump();
        if (!stop) timer = setTimeout(tick, interval);
      };
      void tick();
    }

    (window as unknown as Record<string, unknown>).__viewerStop = () => {
      stop = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
    return () => {
      stop = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [ready, mode, room, interval]);

  return (
    <main>
      <p style={{ color: "#f0b429", fontSize: 13 }}>SPIKE Task159 — trang đo, không phải sản phẩm.</p>
      <h1 style={{ fontSize: 18 }}>
        Viewer — phòng {room}, chế độ {mode}, nhịp {interval} ms
      </h1>
      <p style={{ color: "#9aa4af" }}>Đang nối. Kết quả ở `window.__viewer`.</p>
      <pre style={{ fontSize: 11, color: "#9aa4af" }}>{log.join("\n")}</pre>
    </main>
  );
}
