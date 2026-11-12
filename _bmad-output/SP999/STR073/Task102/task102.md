# Task102: Tái thiết kế giao diện Terminal & ResultGrid trực quan, có ngữ cảnh và tách nhật ký

Thuộc: SP999 / STR073
Mục tiêu: Nâng cấp trải nghiệm vùng Terminal và bảng ResultGrid: Accordion có phân loại loại lệnh & ngữ cảnh, bảng dữ liệu chuẩn mực có viền và kiểu cột, thanh trạng thái tổng kết và ngăn kéo nhật ký hệ thống tách biệt.
Phạm vi:
- `web/src/components/result-grid/result-grid.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/messages/vi/result.json`, `web/messages/en/result.json`
- `web/messages/vi/lab.json`, `web/messages/en/lab.json`
- `web/src/components/result-grid/result-grid.test.tsx`
Không làm: Không thay đổi cấu trúc dữ liệu `QueryResult` từ engine; không ghi log nội dung SQL người dùng vào nhật ký theo Nguyên tắc cốt lõi 7; không làm gãy các bộ test E2E hiện có.

Hợp đồng:
- `ResultGrid({ results, rawSql }: { results: QueryResult[]; rawSql?: string })`: Nhận thêm `rawSql` tùy chọn để trích xuất snippet câu lệnh tương ứng với từng kết quả.
- Nút bấm Accordion của từng câu lệnh vẫn giữ `aria-label` hoặc cấu trúc text bắt đầu bằng `Câu {n}` / `Statement {n}` để tương thích 100% với selector test E2E.
- Danh sách nhật ký `#terminal ol` vẫn hiển thị đúng cấu trúc cho các kiểm thử tự động.

Tiêu chí xong:
- AC1: Thanh Accordion từng câu lệnh:
  - Có icon Chevron chỉ hướng mở (▼) hoặc đóng (▶) rõ ràng, hiệu ứng hover nhã nhặn.
  - Hiển thị số thứ tự `#1`, `#2`... kèm Badge phân loại câu (`DDL`, `INDEX`, `INSERT`, `UPDATE`, `DELETE`, `SELECT`).
  - Hiển thị trích đoạn câu lệnh SQL tương ứng (rút gọn nếu quá dài) để người dùng biết ngay câu đó làm gì mà không cần mở ra đoán.
  - Hiển thị trạng thái hoàn tất: biểu tượng `✓`, số dòng bị ảnh hưởng (`N dòng bị ảnh hưởng`) hoặc số dòng trả về (`N dòng trả về`).
- AC2: Bảng dữ liệu ResultGrid chuẩn mực:
  - Header bảng có viền phân cách rõ ràng, nền tương phản nhẹ với thân bảng.
  - Cột số thứ tự hàng `#` tự động ở đầu bảng, căn giữa, giúp dễ theo dõi vị trí dòng.
  - Căn chỉnh chuẩn: số căn phải (`text-right font-mono`), chuỗi căn trái, `NULL` in nghiêng mờ.
  - Giữ nguyên giới hạn 500 dòng với thông báo cắt dòng và giữ tên cột khi bảng 0 dòng.
- AC3: Header và Footer Terminal:
  - Header Terminal có biểu tượng chấm trạng thái, tên engine hiện tại (`PostgreSQL (PGlite)` hoặc `MySQL (Sandbox)`), cùng các nút thao tác tiện ích ("Mở tất cả" / "Thu gọn", "Xóa").
  - Footer Status Bar hiển thị tổng số câu thực thi thành công và tổng thời gian (nếu có).
  - Nhật ký hệ thống (`Đã tải PostgreSQL`, `Đã chạy X câu`) được tách biệt vào khu vực Drawer hoặc phần log riêng có thể bật/tắt, không in trôi dạt dồn đống ngay dưới bảng dữ liệu.
- AC4: Đầy đủ bản dịch i18n trong `result.json` và `lab.json` cho cả tiếng Việt và tiếng Anh.
- AC5: Toàn bộ kiểm tra tự động `npm run check` (typecheck + lint) và `npm test` trong `web/` pass 100%.

Ca biên: Script chỉ có DDL không có dữ liệu trả về; Script có nhiều câu SELECT liên tiếp; Câu lệnh bị lỗi; Bảng có 0 dòng; Bảng trên 500 dòng; Chạy trên màn hình điện thoại co giãn tốt.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/result-grid/result-grid.test.tsx` trong `web/`.
Góc review thêm: Trải nghiệm người dùng (UX) / Độ tương thích ngược E2E Playwright / Chuẩn accessibility (aria-expanded, aria-controls).
Đọc thêm: Thảo luận Party Mode ngày 12/11/2026 và ảnh lỗi giao diện Terminal.

