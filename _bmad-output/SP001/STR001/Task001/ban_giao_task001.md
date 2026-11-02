# Bàn giao Task001

Đã làm: Tạo ứng dụng Next.js 16.4.4 (App Router, `src/`, alias `@/`, Tailwind 4) trong `web/`, cài đủ thư viện chạy và dev đã chốt, cài 13 component shadcn/ui, thêm các lệnh `typecheck`, `test`, `check`. Trang chủ chỉ là `<main />`.
File chính: `web/package.json`, `web/vitest.config.mts`, `web/src/components/ui/`, `web/src/components/ui/button.test.tsx`, `web/src/app/layout.tsx`.
Kết quả kiểm tra (chạy thật): `npm ci` thoát 0 từ lockfile. `npm run check` thoát 0, 1 test Vitest render `Button` qua. `npm run build` thoát 0. `npm run start` phục vụ `/` mã 200. `node_modules/@electric-sql/pglite/package.json` version 0.5.14, `package.json` ghim chính xác `0.5.14` không dấu `^`. Trang chủ không import thư viện nặng.
Kết quả review: task-reviewer mới, 0 lỗi, 0 needs_validation. Reviewer tự chạy lại ci, check, build, start và đều đạt.
Chưa làm được: không có. Playwright mới cài, chưa có test nào (task không yêu cầu).
Phát sinh (đưa vào SP999):
- Vitest 5 cần `@types/node` ^22 trở lên, nên nâng `@types/node` từ ^20 lên ^22 (khớp Node 22). Không dùng `--force` hay `--legacy-peer-deps`.
- `next-intl` tương thích Next 16, không cần hạ bản.
- `cytoscape` đã kèm kiểu, nên không cài `@types/cytoscape`.
- Đã thêm `jsdom`, `@testing-library/dom`, `@vitejs/plugin-react` làm thư viện dev để Vitest render component.
- Bản scaffold dùng kiểu toàn cục `LayoutProps` do Next sinh ra, làm `typecheck` hỏng trên bản clone sạch. Đã đổi sang kiểu tường minh trong `layout.tsx`.
- `web/AGENTS.md` do create-next-app sinh ra, nhắc đọc `node_modules/next/dist/docs/` trước khi code Next. Phiên chính nên cân nhắc giữ hay bỏ.
- `next.config.ts` do scaffold bật `cacheComponents` và `partialPrefetching`, build vẫn qua. Task sau cần biết khi viết route.
- `next/font/google` cần mạng lúc build (Geist). CI hoặc môi trường offline sẽ cần xử lý.
- `npm audit` báo lỗ hổng ở một số gói, chưa xử lý.
Việc tiếp theo cần biết: Task007 thêm bước kiểm tra bản dịch vào `npm run check` ở `web/package.json`. Subagent gọi được subagent: Amelia (subagent) gọi `task-reviewer` bằng Agent tool thành công.
