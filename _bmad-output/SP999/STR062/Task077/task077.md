# Task077: Làm CI e2e xanh ổn định

Thuộc: SP999 / STR062
Mục tiêu: Job `e2e` trên GitHub Actions xanh ổn định. Mỗi test chập chờn được xử lý đúng nguyên nhân, lỗi thật của sản phẩm thì sửa ở sản phẩm.
Phạm vi: `web/e2e/**`, `web/playwright.config.ts`, `.github/workflows/ci.yml`, và file sản phẩm nếu tìm ra lỗi thật (ghi rõ vào bàn giao).
Không làm: thêm tính năng, đổi ngưỡng để test qua khi chưa biết nguyên nhân, xóa test, thêm `test.skip`.

Các lỗi gần đây trên CI:
- `web/e2e/conflict.spec.ts:164`, mong đợi "Nhịp 1 trên 10", nhận "Nhịp 2 trên 9". Số nhịp khác nghĩa là đang ở kịch bản khác hoặc chọn kịch bản chưa có tác dụng. Có thể là lỗi thật: đổi kịch bản khi đang chạy, hoặc chọn trước khi hydrate.
- `web/e2e/conflict.spec.ts:128`, `selectOption` hết 30 giây ở 390 px.
- `web/e2e/sql-intake.spec.ts:156`, `toBeDisabled` nhận enabled.
- `web/e2e/shell-polish.spec.ts:206`, không có giá trị độ rộng trung gian khi mở cột. Phải xác định animation có chạy thật trên máy chậm không. Nếu chỉ do lấy mẫu theo `requestAnimationFrame` thì đổi cách đo, ví dụ `el.getAnimations()` hoặc `transitionrun`.
- `web/e2e/btree-anim.spec.ts:117` từng lệch 56 đến 61 px, Task065 đã sửa `settle`, theo dõi xem còn không.

Tiêu chí xong:
- AC1: Mỗi lỗi trên có kết luận nguyên nhân kèm bằng chứng, tái hiện bằng CPU chậm (`CPU_THROTTLE` đã có ở `btree-anim.spec.ts`, tách thành helper dùng chung nếu cần), ghi vào bàn giao. Không tái hiện được thì nói rõ là chưa tái hiện.
- AC2: Các trang thử và trang lab có dấu hiệu đã hydrate mà test đợi được, nếu nguyên nhân là bấm trước khi hydrate. Sửa ở helper dùng chung, không rải `waitForTimeout`.
- AC3: Đọc log CI của 5 lượt gần nhất bằng `gh run view --log-failed`, liệt kê mọi test từng trượt, xử lý cả những test ngoài danh sách trên.
- AC4: Trong CI đặt `retries: 1` để một lần chập chờn không chặn, kèm reporter hiện rõ danh sách test `flaky` ở cuối log. Ở máy vẫn `retries: 0`. Việc này không thay thế việc sửa ở AC1.
- AC5: Các spec đã sửa chạy `--repeat-each=5 --workers=1` với CPU chậm 4 lần ở máy: đạt hết. Sau khi phiên chính merge, CI chạy 3 lượt không có test trượt, phiên chính kiểm, ghi rõ trong bàn giao.
- AC6: `npm run check`, `npm run build` thoát 0.

Kiểm tra: `cd web && npm run check`; `E2E_PORT=3177 npx playwright test <các spec đã sửa> --workers=1`. Không chạy cả bộ ở máy, để CI chạy.
Góc review thêm: test có kiểm thật hay không, có che lỗi thật không.
Đọc thêm: `_bmad-output/SP999/STR062/Task065/ban_giao_task065.md`; `web/playwright.config.ts`.
