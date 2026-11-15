# Task128: Engine ghim theo dự án & nhả phiên MySQL khi rời

Thuộc: SP019 / STR091
Mục tiêu: Mỗi dự án nhớ engine của nó và trả lại tài nguyên khi người dùng rời đi, đặc biệt là container MySQL.

Phạm vi:
- `web/src/modules/workspace/engine-binding.ts`
- `web/src/modules/workspace/engine-binding.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/modules/workspace/components/engine-release-toast.tsx`

Không làm:
- Không thêm engine mới (SQLite thuộc SP020).
- Không đổi cách Gin tạo phiên MySQL.
- Không tự tạo container khi chỉ mở dự án.

Hợp đồng:
- `bindEngine(projectId: WorkspaceEngine): void` và `currentEngine(projectId): WorkspaceEngine`.
- `releaseProjectResources(projectId): Promise<void>` gọi API nhả phiên MySQL nếu có; bỏ qua lỗi mạng nhưng ghi log nội bộ, không log SQL.
- `onProjectSwitch(prevId, nextId): Promise<void>`

Tiêu chí xong:
- AC1: Dự án Postgres và dự án SQLite mở lần lượt không lẫn dữ liệu, không lẫn schema.
- AC2: Rời dự án MySQL (đổi dự án hoặc đóng tab trình duyệt) gọi nhả phiên đúng một lần, không gọi lặp.
- AC3: Nhả phiên lỗi mạng thì UI vẫn chuyển dự án, có toast vi/en nói phiên có thể còn treo tới khi hết hạn.
- AC4: Mở dự án MySQL không tự tạo container; chỉ tạo khi người dùng bấm chạy (giữ rào chắn của STR088).
- AC5: Unit test phủ AC2, AC3 với API giả.
- AC6: Không có request nào chứa SQL (Core Rule 7).

Ca biên: đổi dự án liên tiếp 5 lần trong 2 giây; mất mạng; hai tab trình duyệt cùng mở một dự án MySQL.
Giao diện: toast vi/en, tự ẩn, không chặn thao tác.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/engine-binding.test.ts`.
Góc review thêm: bảo mật (không log SQL), nhãn kết luận.
Đọc thêm: `_bmad-output/SP004/STR019/` (hợp đồng phiên MySQL) và `_bmad-output/SP018/STR088/`.
