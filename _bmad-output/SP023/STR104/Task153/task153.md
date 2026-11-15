# Task153: Kéo/đẩy dự án và xử lý xung đột

Thuộc: SP023 / STR104
Mục tiêu: Người dùng mang dự án từ máy lên cloud và từ cloud về máy, và không bị ghi đè im lặng khi hai bên đã khác nhau.

Phạm vi:
- `web/src/modules/cloud/sync.ts`
- `web/src/modules/cloud/sync.test.ts`
- `web/src/modules/cloud/api.ts`

Không làm:
- Không autosave ngầm (chỉ chạy khi người dùng bấm).
- Không đụng handler Gin (Task150).
- Không tự merge nội dung SQL.

Hợp đồng:
- `pullProject(remoteId, scope): Promise<WorkspaceProject>` tạo bản local mới từ cloud.
- `pushProject(projectId): Promise<{ updatedAt: string }>` đẩy bản local lên, gửi kèm `baseUpdatedAt`.
- Xung đột khi server trả 409: trả `{ kind: "conflict", remoteUpdatedAt, localUpdatedAt }` để UI hỏi người dùng.
- Không có timer, không có `setInterval` nào trong module (test grep).

Tiêu chí xong:
- AC1: Kéo dự án từ cloud tạo đúng project + tab local, giữ engine.
- AC2: Đẩy thành công thì `updatedAt` local được cập nhật theo server.
- AC3: Server đổi trước khi đẩy thì nhận 409 và trả trạng thái conflict, không ghi đè.
- AC4: Mất mạng giữa lúc đẩy thì không để lại bản ghi nửa vời; thử lại được.
- AC5: Không có đồng bộ tự động (test grep + kiểm network khi chỉ gõ SQL: 0 request).
- AC6: Unit test phủ AC1–AC4 với API giả.

Ca biên: dự án 100 tab; đẩy cùng dự án từ hai máy; project cloud đã bị xóa; token hết hạn giữa lúc đẩy.
Giao diện: không có (UI ở Task154), nhưng trạng thái conflict phải trả đủ dữ liệu để UI hiển thị.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/cloud/sync.test.ts`.
Góc review thêm: đúng logic, không ghi đè im lặng; bảo mật (không log SQL).
Đọc thêm: `_bmad-output/SP023/STR102/Task150/task150.md`.
