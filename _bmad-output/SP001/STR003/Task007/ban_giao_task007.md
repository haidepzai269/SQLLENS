# Bàn giao Task007

Đã làm: Hai ngôn ngữ `vi` và `en` bằng `next-intl`, URL có tiền tố, mặc định `vi`. Bản dịch tách theo module ở `web/messages/<locale>/<module>.json` (đã có `common`, `home`, `error`). Script `check:i18n` được gọi trong `npm run check`. `LanguageSwitcher` đổi ngôn ngữ và giữ đường dẫn, query, hash. Rule `react/jsx-no-literals` chặn chữ cứng trong `src/app` và `src/components` (trừ `ui` và file test). Trang chủ cũ `<main />` được thay bằng `src/app/[locale]/page.tsx`.
File chính: `web/src/i18n/{routing,request,navigation}.ts`, `web/src/proxy.ts`, `web/src/app/[locale]/{layout,page}.tsx`, `web/src/components/language-switcher.tsx`, `web/scripts/check-i18n.mjs`, `web/src/i18n/check-i18n.test.ts`, `web/messages/**`, `web/eslint.config.mjs`, `web/next.config.ts`.
Kết quả kiểm tra (chạy thật): `npm run check` thoát 0, 6 test pass. `npm run build` thoát 0 với `cacheComponents` và `partialPrefetching` vẫn bật, không phải tắt. Bằng curl: `/` về `/vi` (kể cả có `Accept-Language: en`), có cookie `NEXT_LOCALE=en` thì về `/en`. `/vi` và `/en` có `<html lang>` đúng. `/fr` chuyển `/vi/fr` rồi 404, không crash. Bằng Playwright ở 375px: bấm English từ `/vi?a=1#h` ra `/en?a=1#h`, không tràn ngang.
Kết quả review: task-reviewer mới, 1 lỗi confirmed (matcher của `proxy.ts` thiếu một dấu `\`, proxy không chạy trên `/vi`, `/en`). Đã sửa ở fb12596, reviewer kiểm lại, không còn lỗi mở. Còn needs_validation: sau khi đổi ngôn ngữ phía client, DOM giữ cả hai `<h1>` (bản cũ ẩn, có vẻ do `cacheComponents` giữ trang cũ). Test E2E dùng locator `h1` phải lọc phần tử hiển thị.
Chưa làm được: không kiểm tra trên Vercel (tracing của `messages/**` qua `outputFileTracingIncludes` chỉ kiểm bằng build cục bộ).
Phát sinh (đưa vào SP999):
- `web/src/proxy.ts` nằm ngoài mục Phạm vi nhưng bắt buộc cho `next-intl`. Next 16.4.4 dùng tên `proxy.ts`, không phải `middleware.ts`.
- Test của `check-i18n` đặt ở `web/src/i18n/` thay vì `web/scripts/` để khỏi sửa `vitest.config.mts` (ngoài phạm vi).
- Khi chưa có cookie, proxy bỏ header `Accept-Language` để luôn về `vi` (theo AC2).
- `loadMessages` cần `"use cache"`, nếu không build lỗi prerender với `cacheComponents`. Đọc file bằng `fs` lúc chạy nên thêm `outputFileTracingIncludes`.
- Checker biến chỉ lấy tên đầu mỗi cặp ngoặc nhọn (`shortcut:` trong code), chưa hiểu đầy đủ ICU plural. Object rỗng `{}` ở cả hai ngôn ngữ không bị coi là lỗi.
- `jsx-no-literals` chỉ chặn chữ trong JSX, không chặn chuỗi trong thuộc tính như `aria-label`.
- `/` dùng `layout` có `<html>` trong `[locale]`, nên không có `app/layout.tsx` gốc.
Việc tiếp theo cần biết: Thêm module bản dịch chỉ cần thêm `messages/vi/x.json` và `messages/en/x.json`, dùng `useTranslations("x")`. Link nội bộ dùng `Link`, `useRouter` từ `@/i18n/navigation`. Server component phải gọi `setRequestLocale(locale)` để giữ trang tĩnh.
