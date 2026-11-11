# Task101: Khởi động lại Sandbox sạch & Chạy câu lệnh linh hoạt (Smart Run Scope)

Thuộc: SP999 / STR072
Mục tiêu: Đưa phương thức `fresh()` làm sạch 100% sandbox vào EngineAdapter và hỗ trợ chạy đoạn SQL được bôi đen (Run Selection) hoặc câu lệnh tại con trỏ (Run Statement at Cursor) qua `Ctrl+Enter`.
Phạm vi:
- `web/src/contracts/engine.ts`
- `web/src/engines/postgres/adapter.ts`
- `web/src/components/sql-editor/sql-editor.tsx`
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/components/result-grid/sql-error-view.tsx`
- `web/messages/vi/shell.json`
- `web/messages/en/shell.json`
- `web/src/engines/postgres/adapter.test.ts`

Không làm:
- Không thay đổi hành vi mặc định khi bấm nút Play lúc không có selection (vẫn chạy toàn bộ script).
- Không sửa logic nhận diện mã lỗi của `matchPostgresError`.

Hợp đồng:
- `EngineAdapter.fresh(): Promise<void>`: Làm rỗng hoàn toàn sandbox, xóa sạch lịch sử câu lệnh `ran = []` / `hist = []`.
- `SqlEditorProps.onRun?: (options?: { targetSql?: string; isSelection?: boolean }) => void`
- `SqlEditorProps.onSelectionChange?: (hasSelection: boolean, selectedText: string) => void`

Tiêu chí xong:
- AC1: `createPostgresAdapter` có phương thức `fresh()`. Sau khi gọi `fresh()`, `history()` rỗng và worker được khởi động mới hoàn toàn.
- AC2: Khi người dùng bấm nút "Khởi động lại Sandbox sạch" trong `SqlErrorView`, hệ thống gọi `fresh()`, reset trạng thái bảng. Người dùng bấm Chạy lại câu `CREATE TABLE` trước đó không bị lỗi `42P07` (bảng đã tồn tại).
- AC3: Khi người dùng bôi đen một đoạn text trong SQL Editor, `onSelectionChange` báo `hasSelection = true`. Bấm `Ctrl+Enter` hoặc nút Play chỉ gửi đoạn text được chọn xuống engine thực thi.
- AC4: Khi không bôi đen text, nhấn `Ctrl+Enter` tại một dòng câu lệnh sẽ bóc tách câu lệnh SQL chứa con trỏ (tách theo dấu `;` hợp lệ) và chỉ gửi câu lệnh đó xuống engine thực thi.
- AC5: Đầy đủ nhãn và tooltip tiếng Việt / tiếng Anh, `npm run check` và tests vượt qua 100%.

Ca biên:
- Editor trống: Bấm `Ctrl+Enter` hoặc Play không làm gì.
- Con trỏ nằm ở khoảng trắng giữa 2 dấu chấm phẩy: Bỏ qua hoặc lấy câu lệnh gần nhất có nội dung.
- Chuỗi text bôi đen chứa nhiều câu lệnh: Chạy toàn bộ các câu trong đoạn bôi đen.

Kiểm tra:
- `npm run check`
- `npx vitest run web/src/engines/postgres web/src/components/sql-editor`

