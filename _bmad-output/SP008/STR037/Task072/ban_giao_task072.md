# Bàn giao Task072: Range scan và khác biệt engine trên cây B-Tree

Thuộc: SP008 / STR037
Người làm: Amelia
Reviewer: task-reviewer (ID: e33f2470)

Đã làm:
- Thêm chế độ quét khoảng khóa từ `from` đến `to` trên cây B-Tree.
- Key rơi từ root xuống leaf đầu tiên theo đường đi thật, sau đó trượt ngang qua các leaf tiếp theo bằng con trỏ `next`.
- Đếm số leaf đã đọc, dừng đúng khi vượt khóa `to` hoặc khi hết leaf. Khung nhìn SVG tự động cuộn mượt theo vị trí đang đọc.
- Bỏ bước vẽ leaf giả khi dữ liệu chưa đọc hết: dừng đúng chỗ dữ liệu có thật và hiển thị thông báo phần còn lại chưa đọc (`unread` / `partial`).
- PostgreSQL: bước cuối nhảy từ leaf sang heap thật với `heapPage` khi có, có giải thích song ngữ chỉ minh họa dòng đầu.
- MySQL: adapter trả về `NotSimulated` theo đúng hợp đồng của V1, không vẽ minh họa giả như thật.
- Xử lý các ca biên an toàn: index DESC/NULLS FIRST, khoảng rỗng, từ lớn hơn đến, sai kiểu dữ liệu.
- Bổ sung bộ test Playwright `web/e2e/btree-range.spec.ts` kiểm tra 10 kịch bản bao gồm đối chiếu với database thật.
- Chụp đủ 41 ảnh màn hình nghiệm thu giao diện (1440px & 390px, vi/en, các ca biên) trong thư mục `anh/`.

File chính:
- `web/src/modules/btree-reader/anim/range.ts`
- `web/src/modules/btree-reader/anim/steps.ts`
- `web/src/modules/btree-reader/view/btree-view.tsx`
- `web/src/modules/lab/stage/stage.tsx`
- `web/messages/vi/btree-anim.json`
- `web/messages/en/btree-anim.json`
- `web/e2e/btree-range.spec.ts`
- `_bmad-output/SP008/STR037/Task072/anh/**`

Kết quả kiểm tra:
- `npm run check`: Thoát 0 (500 unit test đạt, bao gồm `range.test.ts` và `range.pg.test.ts` đối chiếu buffers của PostgreSQL thật).
- `npm run build`: Thoát 0.
- `E2E_PORT=3172 npx playwright test e2e/btree-range.spec.ts --workers=1`: Đạt 10/10 test (sau khi sửa trích xuất cell text theo review).
- `npx playwright test e2e/btree-anim.spec.ts --workers=1`: Đạt 11/11 test.
- `npx playwright test e2e/lab-stage.spec.ts --workers=1`: Đạt 40/40 test.

Kết quả review:
- Reviewer chỉ ra lỗi trích xuất text cell ở dòng 203 của `btree-range.spec.ts`. Đã sửa trích xuất trực tiếp từ `text.fill-ink2`, 10/10 test đạt.
- Reviewer kết luận: Đạt toàn bộ 7 tiêu chí AC1 -> AC7. Đủ điều kiện bàn giao và merge vào main.

Chưa làm được: MySQL secondary index rơi hai lần (chờ STR034 dựng cây MySQL thật).
Phát sinh: Không.
Việc tiếp theo cần biết: Cây B-Tree hiện đã hỗ trợ đầy đủ xem điểm rơi đơn khóa và quét khoảng khóa.
