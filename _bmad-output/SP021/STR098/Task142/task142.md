# Task142: In PDF bằng Playwright và kiểm nội dung

Thuộc: SP021 / STR098
Mục tiêu: Chứng minh báo cáo in ra đúng bằng máy, không bằng cách nhìn màn hình.

Phạm vi:
- `web/e2e/audit-pdf.spec.ts`
- `web/e2e/helpers.ts` (chỉ thêm helper nếu cần)
- `web/src/modules/export/print/audit-report.tsx` (chỉ sửa lỗi phát hiện được)

Không làm:
- Không đổi bố cục ngoài việc sửa lỗi test phát hiện.
- Không thêm dependency PDF.
- Không chụp ảnh thay cho kiểm nội dung.

Hợp đồng:
- Test dùng `page.pdf({ format: "A4", printBackground: true })` của Playwright và đọc lại nội dung để kiểm.

Tiêu chí xong:
- AC1: Test chạy thật, sinh PDF, đếm đúng 3 trang.
- AC2: Kiểm được 3 nhãn xuất hiện đúng chỗ trong PDF (không chỉ kiểm DOM).
- AC3: Kiểm disclaimer có mặt ở cả 3 trang.
- AC4: Kiểm tiếng Việt không mất dấu bằng cách so chuỗi có dấu cụ thể.
- AC5: Test chạy ở cả `vi` và `en` (2 lần), pass 100%.
- AC6: Nếu phát hiện card bị cắt, sửa CSS và ghi lại trong bàn giao.

Ca biên: dữ liệu rỗng; 30 findings; đổi ngôn ngữ giữa lúc in (không được trộn hai ngôn ngữ trong một file).
Giao diện: không có (kiểm bằng file PDF sinh ra).
Kiểm tra: `npx playwright test web/e2e/audit-pdf.spec.ts`.
Góc review thêm: test có kiểm tra thật hay chỉ chạy cho có; nhãn kết luận.
Đọc thêm: `_bmad-output/SP021/STR098/Task141/task141.md`.
