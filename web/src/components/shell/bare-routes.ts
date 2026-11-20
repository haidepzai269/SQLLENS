/**
 * Route không có khung ứng dụng (header, vùng cuộn của workspace).
 *
 * /about và /login tự lo bố cục; /share là trang chỉ đọc có header riêng và không được
 * gọi /api/me hay dựng workspace — người nhận link phải xem được cả khi backend không chạy.
 */
export const BARE_ROUTES = ["/about", "/login", "/share"] as const;

export function isBareRoute(pathname: string | null): boolean {
  return pathname !== null && (BARE_ROUTES as readonly string[]).includes(pathname);
}

/**
 * Route không dựng `AuthProvider`, tức là không gọi `/api/me`.
 *
 * Chỉ `/share` nằm ở đây: nội dung người nhận link xem hoàn toàn nằm trong fragment nên
 * phải xem được cả khi Gin tắt. `/login` và `/about` vẫn cần `AuthProvider` — `LoginPage`
 * gọi `useAuth()`, bỏ provider sẽ ném lỗi "useAuth ngoài AuthProvider" và trang đăng nhập trắng.
 */
export const AUTH_FREE_ROUTES = ["/share"] as const;

export function isAuthFreeRoute(pathname: string | null): boolean {
  return pathname !== null && (AUTH_FREE_ROUTES as readonly string[]).includes(pathname);
}
