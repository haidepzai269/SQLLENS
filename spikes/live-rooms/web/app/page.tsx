/**
 * Trang chủ của spike: liệt kê các trang đo. Mỗi trang đo tự ghi kết quả vào
 * `window.__result` để Playwright đọc, không phải đọc chữ trên màn hình.
 */
export default function Home() {
  const links = [
    { href: "/ac1", label: "AC1 — byte mỗi lần publish (snapshot vs /share)" },
    { href: "/ac3", label: "AC3 — byte của B-Tree 100k dòng, không WASM" },
    { href: "/ac2", label: "AC2 — byte mỗi viewer mỗi phút (poll + SSE)" },
    { href: "/viewer", label: "Viewer — nhận snapshot qua poll/SSE" },
  ];
  return (
    <main>
      <h1 style={{ fontSize: 20 }}>Task159 — cổng đo Tầng 0 cho Live Rooms</h1>
      <ul style={{ lineHeight: 1.9 }}>
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} style={{ color: "#7cc4ff" }}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
