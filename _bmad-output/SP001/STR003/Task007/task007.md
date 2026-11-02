# Task007: Hai ngôn ngữ và kiểm tra thiếu bản dịch

Thuộc: SP001 / STR003
Mục tiêu: Có tiếng Việt và tiếng Anh từ dòng code đầu tiên, thiếu bản dịch thì `npm run check` thất bại.
Phạm vi: `web/messages/**`, `web/src/i18n/**`, `web/src/app/**`, `web/src/components/language-switcher.tsx`, `web/scripts/**`, `web/next.config.ts`, `web/package.json`, cấu hình ESLint của `web/`.
Không làm: khung ứng dụng (Task006), thêm ngôn ngữ thứ ba.

Hợp đồng:
- Dùng `next-intl` với URL có tiền tố: `/vi`, `/en`. Mặc định `vi`. Kiểm tra tài liệu của bản Next.js đang cài về tên file middleware hoặc proxy, không dựa vào trí nhớ.
- Bản dịch tách theo module: `web/messages/<locale>/<module>.json`. Tên file là namespace.
- Thêm module mới chỉ cần thêm file JSON, không cần sửa file dùng chung nào. Đây là yêu cầu để task song song không đụng nhau.
- `npm run check:i18n` chạy `web/scripts/check-i18n.mjs`. `npm run check` phải gọi lệnh này.
- `LanguageSwitcher` đổi ngôn ngữ mà giữ nguyên đường dẫn và query.

Tiêu chí xong:
- AC1: `/vi` và `/en` hiển thị đúng ngôn ngữ, `<html lang>` đúng theo trang.
- AC2: `/` chuyển đến `/vi` nếu không có lựa chọn trước đó.
- AC3: Thiếu một key lồng nhau ở `en`: `check:i18n` thoát với mã 1 và in đúng ngôn ngữ, module, key.
- AC4: Thiếu cả file module ở một ngôn ngữ: `check:i18n` thoát với mã 1.
- AC5: Giá trị rỗng, hoặc biến khác nhau giữa hai ngôn ngữ (`{count}` so với `{total}`): `check:i18n` thoát với mã 1.
- AC6: Viết chữ cứng trong JSX ở `web/src/app` hoặc `web/src/components`: `npm run lint` báo lỗi. Thư mục `web/src/components/ui` được miễn. Dùng rule có sẵn nếu có, ví dụ `react/jsx-no-literals`.
- AC7: Test cho `check-i18n.mjs` phủ AC3, AC4, AC5.
- AC8: `npm run check` và `npm run build` thoát với mã 0.

Ca biên:
- Locale không hỗ trợ như `/fr`: trả 404, không crash.
- Giữ đúng dấu tiếng Việt trong JSON, file là UTF-8.

Kiểm tra: `cd web && npm run check && npm run build`, rồi mở `/vi` và `/en`.
Góc review thêm: giao diện, thử bằng trình duyệt thật.
Đọc thêm: `CLAUDE.md` dòng "Ngôn ngữ"; `_bmad-output/QUY_TRINH.md` mục 4; bàn giao Task001.
