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
