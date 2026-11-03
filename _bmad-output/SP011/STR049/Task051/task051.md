# Task051: Đối chiếu giả lập với Postgres thật trong CI

Thuộc: SP011 / STR049
Điều kiện bắt đầu: Task050 đã merge.
Mục tiêu: Mỗi kịch bản của `conflict-sim` được chạy trên Postgres thật bằng hai connection, so với kết quả của `simulate`. Lệch thì CI đỏ, để nhãn Mô phỏng có căn cứ.
Phạm vi: `web/src/modules/conflict-sim/golden/**`, `.github/workflows/**`.
Không làm: sửa mô hình trong `conflict-sim/engine/**` (lệch thì báo trong bàn giao, hoặc sửa nếu lỗi rõ ràng và ghi lại), giao diện.

Hợp đồng:
- `simulate` trả `Outcome<Timeline>`, không phải `Timeline` trần (ghi chú từ Task050).
- Test đọc biến `T051_DATABASE_URL`. Không có biến thì bỏ qua có thông báo, để `npm run check` ở máy vẫn chạy được. Từ chối chạy nếu database không ở `localhost`, vì test tạo và xóa bảng.
- Dùng `pg` (đã có trong `devDependencies`) với hai connection thật, chạy đúng thứ tự `steps`, và phát hiện session bị chờ khóa.
- Các biến thể mức cô lập và guard giống bộ 13 biến thể Task050 đã đối chiếu tay.

Tiêu chí xong:
- AC1: Cả 5 kịch bản ở các mức cô lập có trong test đều chạy trên Postgres 18 thật. So `outcome`, thứ tự câu chờ khóa, và giá trị của `brokenCheck`.
- AC2: Deadlock chỉ so việc có deadlock, không so bên nào bị hủy, vì Postgres không cố định bên bị hủy. Câu lỗi so theo mã SQLSTATE, không so chữ.
- AC3: CI có job chạy service `postgres:18`, đặt `T051_DATABASE_URL` và chạy test này. Lệch thì job đỏ. Job chạy được trên GitHub Actions thật: sau khi merge phiên chính kiểm, nên task ghi rõ cách kiểm vào bàn giao.
- AC4: Tự kiểm test có tác dụng: sửa tạm kết quả mong đợi của một kịch bản thì test đỏ. Ghi lại đã thử, không commit phần sửa tạm.
- AC5: Chạy 5 lần liên tiếp ở máy với Postgres 18 trong Docker (tên container `t051-*`, cổng 54510 trở lên, xóa khi xong): không có lần nào lệch, không treo. Mỗi bước có timeout, session chờ khóa quá hạn thì test báo lỗi rõ.
- AC6: `npm run check` thoát với mã 0. Nếu trượt do máy thiếu RAM thì chạy `npm run test -- --maxWorkers=2` và ghi rõ.

Ca biên: Connection bị hủy do deadlock vẫn được dọn; bảng thử được xóa cả khi test lỗi; chạy lại trên database đã có bảng cũ.
Kiểm tra: `cd web && npm run check`; AC5.
Góc review thêm: test có kiểm thật hay không, đúng hành vi PostgreSQL.
Đọc thêm: `_bmad-output/SP011/STR048/Task050/ban_giao_task050.md`; `CLAUDE.md` nguyên tắc 1 và mục "Khác biệt giữa hai engine"; `.github/workflows/` hiện có.
