# Task145: Route `/share` đọc fragment, trạng thái lỗi, chặn referrer

Thuộc: SP022 / STR100
Mục tiêu: Mở link chia sẻ là thấy nội dung, và nếu link hỏng thì thấy lời giải thích thay vì trang trắng.

Phạm vi:
- `web/src/app/[locale]/share/page.tsx`
- `web/src/modules/share/share-view.tsx`
- `web/src/modules/share/share-view.test.tsx`
- `next.config.ts` (hoặc middleware hiện có) cho header `Referrer-Policy`

Không làm:
- Không style nội dung snapshot (Task146).
- Không fork (Task147), không chạy SQL (Task148).
- Không gửi payload lên server dưới bất kỳ hình thức nào.

Hợp đồng:
- Trang là client component đọc `window.location.hash`, tách tham số `d`, gọi `decodeSnapshot`.
- 4 trạng thái: `loading`, `ready`, `invalid`, `missing`.
- `invalid` hiện mã lỗi từ codec; `missing` hiện hướng dẫn xin link mới.
- Header `Referrer-Policy: no-referrer` áp cho route `/share`.

Tiêu chí xong:
- AC1: Mở link hợp lệ thì render snapshot, không có request nào chứa payload (kiểm network).
- AC2: Hash hỏng hoặc sai version hiện màn lỗi có nút "Về trang chủ", không trắng trang, không lộ stack trace.
- AC3: Không có `#d=` hiện trạng thái `missing`, không ném lỗi console.
- AC4: `curl -I` trên production thấy `Referrer-Policy: no-referrer` cho `/share`.
- AC5: Trang không render nội dung snapshot thành HTML sống (chỉ text trong editor).
- AC6: Unit test phủ 4 trạng thái.

Ca biên: payload 32KB; hash có `#d=` rỗng; hash có tham số khác; mở bằng Safari; mở khi JS chậm (loading rõ ràng).
Giao diện: 4 trạng thái đều có bản vi/en, đọc được 390px.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/share-view.test.tsx`.
Góc review thêm: bảo mật (referrer, XSS), giao diện vi/en.
Đọc thêm: `_bmad-output/SP022/STR099/Task143/task143.md`.
