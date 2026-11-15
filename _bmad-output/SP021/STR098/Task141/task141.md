# Task141: Bố cục báo cáo Audit A4 3 trang

Thuộc: SP021 / STR098
Mục tiêu: Có một trang báo cáo in được, đọc như tài liệu bàn giao, và không nói dối về mức độ chắc chắn của kết luận.

Phạm vi:
- `web/src/modules/export/print/audit-report.tsx`
- `web/src/modules/export/print/print.css`
- `web/src/app/[locale]/print/audit/page.tsx`
- `web/messages/vi/export.json`, `web/messages/en/export.json`

Không làm:
- Không sinh PDF trên server, không Puppeteer.
- Không tự suy ra finding mới; chỉ dùng dữ liệu findings và plan đã có.
- Không đổi trang lab.

Hợp đồng:
- Route `/[locale]/print/audit` đọc cùng nguồn dữ liệu với tab Findings và Plan; không nhận dữ liệu qua query string dài.
- `@page { size: A4; margin: 14mm }`; mỗi trang là một `<section class="report-page">` cao đúng một trang in.
- Header mỗi trang: tên dự án, engine, ngày, số trang; chân trang: disclaimer sandbox.

Tiêu chí xong:
- AC1: In ra đúng 3 trang: (1) bìa + điểm sức khỏe, (2) findings kèm bằng chứng, (3) kế hoạch thực thi.
- AC2: Mọi kết luận giữ đúng nhãn Thật / Mô phỏng / Ước lượng; không có câu nào hàm ý "thiết kế này ổn" (Core Rule 2).
- AC3: Không card nào bị cắt đôi giữa hai trang (`break-inside: avoid` hoạt động thật khi in).
- AC4: Tiếng Việt không lỗi font, không mất dấu; số liệu định dạng theo ngôn ngữ.
- AC5: Disclaimer sandbox có ở chân cả 3 trang.
- AC6: Dữ liệu rỗng (chưa chạy gì) vẫn in ra báo cáo không lỗi, ghi rõ "chưa có kết luận".

Ca biên: 30 findings; tên bảng dài 60 ký tự; tiếng Việt và tiếng Anh; theme tối (bản in vẫn phải nền sáng).
Giao diện: đủ vi/en; bản xem trên màn hình phản ánh đúng bản in.
Kiểm tra: `npm run check`, mở `/[locale]/print/audit` và in bằng Chrome ra PDF để xem 3 trang.
Góc review thêm: nhãn kết luận, giao diện vi/en.
Đọc thêm: `web/src/contracts/finding.ts`, `_bmad-output/SP021/README.md` mục ràng buộc nhãn.
