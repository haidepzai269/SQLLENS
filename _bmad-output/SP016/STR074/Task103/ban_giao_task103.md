# Bàn giao Task103: Sửa nút Hỏi AI Mentor tại Terminal, Stream SSE chẩn đoán và 1-Click Fix

Đã làm: Khắc phục triệt để lỗi nút "Hỏi AI Mentor về lỗi này" tại Terminal không phản hồi bằng cách truyền prop `onAskAi` và `onApplyFix` từ `lab-workspace.tsx`. Xây dựng module client API SSE `diagnoseSqlError` tại `diagnose.ts` kết nối tới `/api/ai/diagnose`. Tích hợp khối AI Doctor Card mở rộng ngay dưới thẻ lỗi hiển thị văn bản realtime delta stream, tự động bóc tách code block SQL đề xuất và cung cấp nút "Áp dụng sửa ngay (1-Click Fix)" để thay thế câu lệnh trong SQL Editor. Xử lý loading spinner chặn double-click, nút Hủy/Đóng ngắt stream và nút Thử lại khi gặp lỗi kết nối hoặc quota. Bổ sung bản dịch song ngữ `vi` và `en` trong `result.json`.

File chính:
- `web/src/modules/mentor/api/diagnose.ts`: Client API SSE gọi POST /api/ai/diagnose và hàm extractSuggestedSql.
- `web/src/modules/mentor/api/diagnose.test.ts`: Unit test bao quát cho module chẩn đoán và trích xuất SQL.
- `web/src/components/result-grid/sql-error-view.tsx`: Giao diện hiển thị lỗi kèm AI Doctor Card và nút 1-Click Fix.
- `web/src/components/result-grid/sql-error-view.test.tsx`: Unit test kiểm thử luồng mở chẩn đoán, stream và 1-Click Fix.
- `web/src/modules/lab/lab-workspace.tsx`: Nối đầy đủ các callback `onAskAi` và `onApplyFix` vào `<SqlErrorView />`.
- `web/messages/vi/result.json`, `web/messages/en/result.json`: Bản dịch song ngữ nhóm `aiDoctor`.

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100% (0 lỗi thiếu key hoặc lệch ICU).
- `npm run lint`: PASS (0 error).
- `npm run typecheck`: PASS (0 lỗi TypeScript).
- `npm test`: 65 test files (63 passed, 2 skipped do thiếu URL db ngoài), 697 tests passed 100%.

Kết quả review: 0 lỗi, 0 needs_validation, reviewer độc lập xác nhận đạt 100% tiêu chí chấp nhận AC1-AC7.
Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Task104 và Task105 sẽ triển khai linh kiện CustomSwitch độc quyền SVG Cross/Checkmark và xây dựng màn hình `/settings`.
