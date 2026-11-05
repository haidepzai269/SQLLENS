// Route thử `/<locale>/e2e-*` chỉ phục vụ Playwright; production phải trả 404.
export function isBlockedE2eRoute(pathname: string, vercelEnv: string | undefined): boolean {
  if (vercelEnv !== "production") return false;
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // đường dẫn sai mã hóa: giữ nguyên, không khớp thì cho đi tiếp để Next tự xử lý
  }
  return /^\/+(vi|en)\/+e2e-/i.test(p);
}
