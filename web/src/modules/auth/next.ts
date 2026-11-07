// Đường dẫn quay về sau đăng nhập: chỉ nhận đường dẫn trong site. Khớp quy tắc safeNext của Gin (api/internal/auth/oauth.go).
// Trình duyệt bỏ tab và xuống dòng khi phân giải URL ("/\t/evil" thành "//evil"), nên ký tự điều khiển bị loại.
export function safeNext(raw: string | null | undefined, locale: string): string {
  const home = `/${locale}`;
  if (!raw || raw.length > 400 || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return home;
  if (/[\x00-\x20\x7f\\]/.test(raw)) return home;
  try {
    const u = new URL(raw, "http://x.invalid");
    if (u.origin !== "http://x.invalid") return home;
    // Về chính trang đăng nhập thì vòng lặp.
    if (/^\/(?:[a-z]{2}\/)?login\/?$/.test(u.pathname)) return home;
    u.searchParams.delete("auth_error");
    return u.pathname + u.search + u.hash;
  } catch {
    return home;
  }
}

// Gin đưa người dùng về `next` kèm ?auth_error khi lỗi. Cho lỗi hiện ở trang đăng nhập thì next của Gin là trang đăng nhập, mang next thật theo.
// Dài quá giới hạn 512 ký tự của Gin thì bỏ lớp ngoài: lỗi sẽ hiện ở trang đích thay vì ở đây.
export function providerNext(next: string, locale: string): string {
  const nested = `/${locale}/login?next=${encodeURIComponent(next)}`;
  return nested.length <= 500 ? nested : next;
}
