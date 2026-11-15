# Task155: Cổng `security-audit` cho toàn Epic

Thuộc: SP023 / STR105
Mục tiêu: Đóng Epic bằng một lượt kiểm bảo mật đầy đủ trên diff thật, không bằng lời khẳng định.

Phạm vi:
- `_bmad-output/SP023/STR105/bao-cao-security-audit.md` (báo cáo)
- Các file phát hiện lỗi (sửa trong chính task này nếu còn trong phạm vi)

Không làm:
- Không sửa tính năng mới.
- Không bỏ qua lỗi nghiêm trọng bằng cách thêm suppression.
- Không chạy trên production (chạy Docker tắt mạng).

Hợp đồng:
- Phạm vi audit: diff của `Task149`–`Task154` cộng `Task143`–`Task148`.
- Chạy skill `security-audit` theo `ATTACK-CLASSES.md`, tập trung: auth, RLS, SQL người dùng, nội dung công khai trong URL, log.

Tiêu chí xong:
- AC1: Chạy trong Docker tắt mạng, không truy cập Internet trong lúc audit.
- AC2: Mọi phát hiện có bằng chứng: file, dòng, cách tái hiện.
- AC3: Không còn lỗi mức nghiêm trọng hoặc cao chưa xử lý.
- AC4: Lỗi còn lại ghi vào `SP999` kèm lý do và mức độ.
- AC5: Báo cáo có phần riêng kiểm Core Rule 7 (không log SQL) với bằng chứng grep.
- AC6: Kết luận rõ: được đóng Epic hay không.

Ca biên: môi trường thiếu Docker (phải báo là chưa chạy, không được ghi pass); diff quá lớn (chia 2 lượt, ghi rõ).
Kiểm tra: chạy audit, lưu báo cáo; `git diff --stat` xác nhận phạm vi đã kiểm.
Góc review thêm: bảo mật (toàn bộ), tính trung thực của báo cáo.
Đọc thêm: `.claude/skills/security-audit/`, `_bmad-output/SP023/README.md`.
