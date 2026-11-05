# Task075: `EngineAdapter` MySQL và màn hình phiên

Thuộc: SP004 / STR019
Điều kiện bắt đầu: Task074 đã merge. Cổng Azure chưa mở cũng làm được, vì test dùng route giả. Phiên chính kiểm với máy thật sau khi chủ dự án mở cổng.
Mục tiêu: Người dùng đã đăng nhập chọn MySQL, chờ phiên khởi động, chạy SQL trên MySQL thật qua Gin, thấy kết quả nhãn Thật và plan.
Phạm vi: `web/src/engines/mysql/**`, `web/src/modules/lab/lab-workspace.tsx` (chỗ chọn adapter theo engine), `web/src/modules/lab/stage/stage.tsx` (chỉ phần tab phụ thuộc engine), `web/src/modules/auth/mysql-access.tsx`, `api/internal/auth/auth.go` (xóa route tạm `/mysql/ping`), `web/messages/{vi,en}/mysql.json`, `web/e2e/mysql.spec.ts`, `web/e2e/auth.spec.ts`.
Không làm: dựng cây B-Tree MySQL (STR034), thử sửa bằng bảng clone (STR044), tranh chấp MySQL (STR050), sửa sandbox agent.

Hợp đồng: Cài đủ `EngineAdapter` trong `web/src/contracts/engine.ts`, gọi các route trong bàn giao Task074, mã lỗi theo hợp đồng ở đó.
- `readBTree`, `tryChange` trả `NotSimulated` với lý do riêng, cho đến STR034, STR044.
- `explain` chạy `EXPLAIN FORMAT=JSON` qua phiên, chuẩn hóa bằng `normalizeMysql`. Plan MySQL `analyzed: false`, số dòng là ước lượng của optimizer, nên kết luận mang nhãn Ước lượng, không được ghi Thật. Câu SQL chạy thật thì kết quả mang nhãn Thật.
- `cancel` hủy phiên, `rebuild` tạo phiên mới rồi chạy lại `history()`.
- Lỗi parse của `node-sql-parser` không được chặn việc gửi cho MySQL thật, theo `CLAUDE.md`.

Tiêu chí xong (test dùng route giả cho `/api/mysql/*` và mock `/api/me`):
- AC1: Chọn MySQL khi đã đăng nhập: hiện đang khởi động phiên, rồi sẵn sàng. Không tạo phiên khi chỉ mở trang, chỉ tạo khi bấm Chạy lần đầu, để không tiêu hạn mức vô ích. Chạy `SELECT` hiện lưới kết quả nhãn Thật.
- AC2: Mỗi lỗi có màn hình riêng và đúng hành động: hết chỗ (`sandbox_full`), đã có phiên của mình (`user_session_limit`), hết hạn mức ngày, hết ngân sách thời gian, tần suất, phiên hết hạn hoặc 404, agent không tới được (502), quá thời hạn (504), kết quả quá lớn (422), chưa cấu hình (503 `not_configured`). `not_configured` nói rõ MySQL chưa sẵn sàng và mời dùng PostgreSQL.
- AC3: Phiên hết hạn giữa chừng: báo rõ dữ liệu trong phiên đã mất, có nút tạo phiên mới, không tự chạy lại câu ghi khi người dùng chưa đồng ý.
- AC4: Đổi engine, đăng xuất hoặc đóng tab thì hủy phiên, dùng `keepalive` hoặc `sendBeacon` nếu làm được. Tải lại trang giữa phiên không làm người dùng bị khóa bởi `user_session_limit`: lưu id phiên ở `sessionStorage` để dùng lại hoặc hủy. Đây là cách xử lý rủi ro tự khóa ghi ở Task074.
- AC5: Tab `stage` với MySQL: Sơ đồ đọc từ `information_schema`, Plan chạy, B-Tree, Thử sửa, Capacity hiện `NotSimulated` có lý do, không vỡ. Không gửi SQL người dùng vào log, không có SQL trong URL.
- AC6: Xóa nút kiểm tra và route `/mysql/ping`, sửa spec liên quan. Trần 20 lượt không còn ghi cứng ở client.
- AC7: `npm run check`, `npm run build` thoát 0, `cd api && go vet ./... && go test -count=1 ./...` đạt. `web/e2e/mysql.spec.ts`, `web/e2e/auth.spec.ts`, `web/e2e/lab.spec.ts`, `web/e2e/lab-stage.spec.ts` đạt với `--workers=1`.

Giao diện: Đủ tiếng Việt và tiếng Anh, 1440 và 390 px. Lưu ảnh chụp trong `_bmad-output/SP004/STR019/Task075/anh/`, gồm đang khởi động, sẵn sàng, hết chỗ, hết hạn, chưa cấu hình, tự mở xem, ghi rõ đã xem ảnh nào.
Ca biên: bấm Chạy hai lần khi đang tạo phiên, đổi engine khi đang tạo phiên, câu chạy quá 15 giây, nhiều câu trong một lô, kết quả bị cắt ở 10.000 dòng phải ghi rõ đã cắt.
Góc review thêm: bảo mật, nhãn kết luận, giao diện.
Đọc thêm: `_bmad-output/SP004/STR019/Task074/ban_giao_task074.md`; bàn giao Task044, Task046, Task062; `CLAUDE.md` mục "Khác biệt giữa hai engine".
