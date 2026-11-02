# Task004: Mẫu giao diện HTML

Thuộc: SP001 / STR002
Người làm: Sally, không phải Amelia. Task này không qua vòng code và review thông thường. Chủ dự án là người duyệt.
Mục tiêu: Tạo mẫu HTML để chủ dự án xem, sửa, rồi chốt làm chuẩn giao diện của sản phẩm.
Phạm vi: `_bmad-output/SP001/STR002/Task004/**`.
Không làm: code trong `web/`, logic thật, kết nối PGlite.

Hợp đồng:
- Đầu ra là `mau_giao_dien.html`, một file tự chứa, mở trực tiếp được bằng trình duyệt.
- Dữ liệu trong mẫu là dữ liệu minh họa, phải khớp với cách sản phẩm thật hiển thị.

Tiêu chí xong:
- AC1: Có màn hình chính: ô dán SQL, kết quả, sơ đồ, cây B-Tree, danh sách rủi ro.
- AC2: Có một cảnh B-Tree dựng bằng SVG và GSAP: key rơi từ root qua internal xuống leaf, chạy từng bước, tua lại, kèm câu giải thích.
- AC3: Nhãn Thật, Mô phỏng, Ước lượng có hình thức riêng, phân biệt được cả khi không nhìn màu.
- AC4: Có trạng thái "chưa mô phỏng được". Không có câu nào hàm ý "thiết kế này ổn".
- AC5: Đổi được tiếng Việt và tiếng Anh ngay trong mẫu.
- AC6: Không cuộn ngang ở chiều rộng 390 px và 1440 px, kiểm bằng trình duyệt thật.
- AC7: Tab NoSQL và LSM-Tree hiện ở trạng thái khóa.
- AC8: Có `ghi_chu_thiet_ke.md` ghi màu, font, khoảng cách và lý do, để Task005 chuyển thành token.

Ca biên: bật giảm chuyển động thì animation chuyển thành từng bước, không tự chạy.
Kiểm tra: mở file trong trình duyệt thật, chụp ảnh ở 390 px và 1440 px, lưu vào thư mục task.
Đọc thêm: `CLAUDE.md` mục "Sản phẩm là gì", "Phạm vi V1", "Nguyên tắc không được phá", "Giao diện B-Tree"; `_bmad-output/QUY_TRINH.md` mục 8.
