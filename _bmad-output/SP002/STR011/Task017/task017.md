# Task017: Điều khoản dịch vụ và công cụ

Thuộc: SP002 / STR011
Người làm: Mary (nghiên cứu), không viết code.
Mục tiêu: Trả lời các câu hỏi về điều khoản và giới hạn còn nằm trong mục "Chưa kiểm chứng" của `CLAUDE.md`, bằng nguồn chính thức.
Phạm vi: `_bmad-output/SP002/STR011/Task017/**`.
Không làm: đăng ký tài khoản, gọi API có key, sửa code.

Tiêu chí xong:
- AC1: Render free: điều khoản có cho phép ping giữ thức không, giới hạn giờ chạy mỗi tháng, thời gian ngủ khi nhàn rỗi. Với lịch 7:00 đến 24:00 giờ Việt Nam thì một tháng dùng bao nhiêu giờ, so với hạn mức.
- AC2: Neon free: hạn mức CU-giờ mỗi tháng là 50 hay 100, dung lượng, thời gian tự tắt, số kết nối. Lấy từ trang giá hoặc tài liệu của Neon.
- AC3: Upstash Redis free: số lệnh mỗi tháng, dung lượng, giới hạn mỗi giây.
- AC4: Gemini API, Groq, OpenRouter gói free: dữ liệu gửi lên có bị dùng để huấn luyện không, có bị người xem không, giữ bao lâu, có tùy chọn tắt không. Trả lời riêng cho từng bên, kèm giới hạn tần suất nếu có công bố. Kết luận: bên nào được phép nhận SQL của người dùng theo nguyên tắc 7 của `CLAUDE.md`.
- AC5: Oracle Always Free: cấu hình máy ARM hiện tại, chính sách thu hồi máy nhàn rỗi, tình trạng thiếu máy ARM ở các region gần Việt Nam.
- AC6: agent-browser có hỗ trợ Windows không. Nếu không, đề xuất cách kiểm giao diện thay thế đang có: Playwright.
- AC7: `ket_qua.md`: mỗi câu trả lời có link nguồn chính thức và ngày tra. Nguồn không chính thức phải ghi rõ. Không tìm được thì ghi "chưa xác minh", không đoán.

Kiểm tra: phiên chính mở lại ít nhất 3 nguồn ngẫu nhiên để đối chiếu.
Đọc thêm: `CLAUDE.md` mục "Chưa kiểm chứng". Không đọc `KEY_CAN_LAY.md`.
