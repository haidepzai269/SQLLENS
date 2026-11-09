# Bàn giao Task083: Nghiệm thu kết nối mạng thật Render → Azure VM (MySQL Sandbox)

Thuộc: SP004 / STR019  
Người thực hiện: Amelia & Orchestrator  
Người nghiệm thu thực địa: Chủ dự án & Agent  
Ngày nghiệm thu: 2026-11-09  

---

## 1. Đã làm & Bằng chứng thực tế:

1. **Thông mạng đầu cuối:**
   - Cổng 8443 trên Azure VM NSG và tường lửa `ufw` đã mở cho dải IP của Render Singapore (`74.220.52.0/24, 74.220.60.0/24`).
   - 3 biến môi trường `SANDBOX_URL`, `SANDBOX_TOKEN`, `SANDBOX_CERT_SHA256` đã cấu hình chính xác trên Render Dashboard.
   - Gin backend trên Render kết nối an toàn tới `sqllens-agent` trên máy ảo Azure qua HTTPS ghim vân tay chứng chỉ SHA-256.

2. **Thực thi trên môi trường Production thật:**
   - Người dùng đăng nhập tài khoản thật, chọn dialect **MySQL**, nhập câu lệnh:
     ```sql
     SELECT 1 + 1 AS ket_qua;
     ```
   - Sandbox agent trên Azure VM khởi tạo container Docker MySQL 8.4 theo phiên người dùng trong < 3 giây.
   - Kết quả trả về chính xác: `ket_qua = 2`, tổng 1 dòng.
   - Panel Terminal thông báo: *"Phiên MySQL đã sẵn sàng. Dữ liệu trong phiên mất khi phiên hết hạn hoặc khi bạn đổi engine, đăng xuất, đóng tab."*
   - Panel Findings hiển thị nhãn **`Thật`** và câu nhận định: *"MySQL vừa chạy 1 câu, câu cuối trả 1 dòng. Đây là kết quả của dữ liệu và câu lệnh này, chưa nói gì về chất lượng thiết kế."*

3. **Tuân thủ 4 Nguyên tắc Cốt lõi:**
   - **Nguyên tắc 1 (Mỗi kết luận mang đúng 1 nhãn):** Kết quả truy vấn MySQL thật mang đúng nhãn `Thật`.
   - **Nguyên tắc 2 (Không bao giờ nói "thiết kế này ổn"):** Tuyệt đối không có câu nào hàm ý khen thiết kế hay câu lệnh tối ưu.
   - **Nguyên tắc 7 (Zero SQL Logging):** Không in nội dung SQL của người dùng hay token ra log server.
   - **Nguyên tắc 8 (SQL người dùng là untrusted):** Container chạy bằng role quyền thấp, giới hạn CPU 0.5 core, RAM 512MB, mạng ngoài bị ngắt (`--network none`).

---

## 2. File chính & Cấu hình:
- `_bmad-output/SP004/STR019/Task083/task083.md`
- `_bmad-output/SP004/STR019/Task083/ban_giao_task083.md`
- `api/internal/mysql/{mysql,client,budget}.go` (Task074)
- `web/src/engines/mysql/adapter.ts` (Task075)

---

## 3. Kết quả nghiệm thu:
- **Đạt 100% 6/6 ACs** của Task083.
- Toàn bộ **Epic SP004 (Sandbox MySQL)** chính thức hoàn tất 100%!
- Đưa tổng tiến độ dự án lên **56/61 Stories (91.8%)**, **77 Tasks đã bàn giao**.

---

## 4. Việc tiếp theo cần biết (Chuyển tiếp Lộ trình 2):
- Bắt tay ngay vào **Đợt 5B — SP008 / STR034 (Task084: Cây B-Tree InnoDB dựng từ stats thật, trực quan hóa rơi key 2 lần - Bookmark Lookup)**.
