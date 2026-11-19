# Bàn giao Task 141: Bố cục báo cáo Audit A4 3 trang

Đã làm:
- Hiện thực hóa giao diện báo cáo Audit A4 3 trang in được (`web/src/modules/export/print/audit-report.tsx`), đọc dữ liệu từ `useWorkspaceStore` hoặc prop `data`.
- Trang 1: Bìa, Tên dự án, Engine, Ngày in, Điểm sức khỏe ước lượng (`healthScore`) kèm nhãn `estimated`/`not_simulated`, Tóm tắt rủi ro 3 mức (Broken/Unverified/Not Broken - tuân thủ tuyệt đối Core Rule 2: không nói thiết kế ổn), Phạm vi 8 luật SQLLens.
- Trang 2: Chi tiết rủi ro & bằng chứng kỹ thuật, hỗ trợ tên bảng dài 60 ký tự (`break-words`), giới hạn 10 rủi ro nghiêm trọng nhất kèm notice thu gọn khi có 30 findings (ca biên) tránh tràn trang A4.
- Trang 3: Kế hoạch thực thi Plan & các bước thực thi thụt lề theo độ sâu cây, chỉ số dòng thực tế / ước tính / số trang đĩa đã đọc.
- Bố cục in ấn A4 chuẩn (`web/src/modules/export/print/print.css`): `@page { size: A4; margin: 14mm }`, mỗi trang là `<section className="report-page avoid-break">` cao đúng 269mm khi in, chân cả 3 trang có Disclaimer sandbox (AC5).
- Tương phản cao cho nhãn in ấn (`ConclusionBadge` nền sáng nhẹ, chữ đậm `#0f172a`, viền rõ nét trên giấy in trắng A4).
- Route Next.js App Router `/[locale]/print/audit` (`web/src/app/[locale]/print/audit/page.tsx`), song ngữ 100% qua `web/messages/{vi,en}/export.json`.

File chính:
- `web/src/modules/export/print/audit-report.tsx`
- `web/src/modules/export/print/print.css`
- `web/src/app/[locale]/print/audit/page.tsx`
- `web/src/modules/export/print/audit-report.test.tsx`
- `web/messages/vi/export.json`, `web/messages/en/export.json`

Kết quả kiểm tra:
- `check:i18n`: PASS 100% (đối xứng, 0 lỗi).
- `lint` (eslint): PASS (0 errors, exit code 0).
- `typecheck` (`tsc --noEmit`): PASS (0 errors, exit code 0).
- `vitest`: PASS 16/16 tests của `src/modules/export/print/audit-report.test.tsx`; 1.285/1.285 tests toàn bộ dự án pass.
- `next build`: PASS (tất cả 60 routes bao gồm `/vi/print/audit` và `/en/print/audit` build thành công).

Kết quả review:
- Vòng 1: Reviewer bắt 2 lỗi confirmed (lint setState trong effect và tương phản nhãn trắng trên nền trang in trắng).
- Vòng 2: Đã sửa triệt để (dùng `useSyncExternalStore` và CSS high-contrast cho badge trong `.report-page`), Reviewer nghiệm thu PASS 100%.

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Task 142 (In PDF bằng Playwright và kiểm nội dung) có thể dùng route `/[locale]/print/audit` và component `AuditReport` để thực hiện print to PDF và assert nội dung văn bản 3 trang.
