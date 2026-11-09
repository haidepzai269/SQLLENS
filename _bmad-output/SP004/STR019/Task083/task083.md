# Task083: Nghiệm thu kết nối mạng thật Render → Azure VM (MySQL Sandbox)

## 1. Mục tiêu & Bối cảnh
- **Story:** SP004 / STR019 (Nối MySQL sandbox vào sản phẩm).
- **Bối cảnh:**
  - Task074 đã cài đặt cổng HTTPS 8443 ghim cert, token bí mật 64 hex, và package `api/internal/mysql` trên Gin backend.
  - Task075 đã xây dựng adapter `createMysqlAdapter`, xử lý vòng đời phiên MySQL (khởi tạo, sẵn sàng, hết hạn, hết chỗ).
  - Chủ dự án đã mở cổng 8443 trên Azure NSG cho dải IP của Render (`74.220.52.0/24, 74.220.60.0/24`), mở `ufw` trên Azure VM, và điền 3 biến môi trường `SANDBOX_URL`, `SANDBOX_TOKEN`, `SANDBOX_CERT_SHA256` trên Render.
- **Mục tiêu của Task083:** 
  1. Kiểm tra nghiệm thu kết nối thực tế giữa Render Backend và Sandbox Agent trên Azure VM.
  2. Xác nhận luồng tạo phiên, chạy câu lệnh DDL/DML, đọc dữ liệu lưới kết quả mang nhãn `Thật`, và hủy phiên thành công khi kết thúc.
  3. Kiểm tra các ca biên: timeout câu lệnh (15s), cắt kết quả quá 10.000 dòng, dọn sạch container Docker khi hủy phiên hoặc hết hạn.

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC1 (Thông mạng Render ↔ Azure VM):** Backend Gin trên Render kết nối thành công tới `https://20.2.9.241:8443` qua cổng HTTPS ghim vân tay chứng chỉ, không bị lỗi 503 `not_configured` hay 502 `sandbox_unreachable`.
- **AC2 (Tạo phiên & Chạy SQL thật):**
  - Người dùng đăng nhập, chọn MySQL, bấm Chạy.
  - Container Docker MySQL 8.4 khởi động sẵn sàng trong < 5 giây.
  - Câu lệnh `SELECT 1 + 1 AS ket_qua;` trả về đúng dữ liệu, lưới kết quả mang nhãn `Thật`.
- **AC3 (Sơ đồ Schema từ MySQL thật):**
  - Chạy `CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(100));`.
  - Tab Sơ đồ bảng đọc cấu trúc từ `information_schema.COLUMNS` của MySQL thật, hiển thị bảng `users` với khóa chính PK `id`.
- **AC4 (Timeout 15 giây):**
  - Chạy câu lệnh `SELECT SLEEP(20);`.
  - Hệ thống ngắt chính xác ở 15 giây và trả về thông báo lỗi quá thời gian câu lệnh, không làm treo server.
- **AC5 (Dọn dẹp container khi hủy phiên):**
  - Khi người dùng đăng xuất hoặc đổi sang engine PostgreSQL, container Docker tương ứng trên Azure VM lập tức bị xóa sạch (`docker ps` không còn container mồ côi).
- **AC6 (Tuân thủ Nguyên tắc cốt lõi):**
  - Nguyên tắc 1: Kết quả từ MySQL mang nhãn `Thật`, Plan mang nhãn `Ước lượng` (`EXPLAIN FORMAT=JSON`).
  - Nguyên tắc 2: Tuyệt đối không khẳng định "thiết kế này ổn".
  - Nguyên tắc 7: Không in SQL của người dùng hay token ra log server.
  - Nguyên tắc 8: SQL người dùng chạy bằng role quyền thấp trong container.

## 3. Các bước kiểm tra thực địa & Tài liệu bàn giao
1. Viết script kiểm thử đầu cuối hoặc kịch bản Playwright xác thực với endpoint thật.
2. Kiểm tra log của Render và `systemctl status sqllens-agent` trên máy Azure để đảm bảo không có lỗi TLS hay 401.
3. Xuất tài liệu bàn giao `ban_giao_task083.md`.

