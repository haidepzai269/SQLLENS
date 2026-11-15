# Task124: Nối workspace vào Lab, bỏ state cục bộ

Thuộc: SP019 / STR089
Mục tiêu: Cho editor hiện tại đọc/ghi qua workspace store để F5 không mất nội dung, không đổi giao diện.

Phạm vi:
- `web/src/modules/workspace/hydrate.ts`
- `web/src/modules/workspace/hydrate.test.ts`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/e2e/workspace-persist.spec.ts`

Không làm:
- Không làm Tab Bar (Task125).
- Không đổi bố cục Stage, không đổi phím tắt.
- Không đụng backend.

Hợp đồng:
- `bootWorkspace(scope: WorkspaceScope): Promise<{ projectId: string; tabId: string }>` nạp store từ IndexedDB; nếu scope chưa có project thì tạo project `Mặc định` (engine `postgres`) và 1 tab trống.
- `flushWorkspace(): Promise<void>` gọi trước `pagehide`.

Tiêu chí xong:
- AC1: Gõ SQL, F5 → nội dung còn nguyên, văn bản khớp 100%.
- AC2: Lần mở đầu tiên tự tạo đúng 1 project + 1 tab, không tạo trùng sau F5.
- AC3: `lab-workspace.tsx` không còn `useState` giữ nội dung SQL; nguồn duy nhất là store.
- AC4: Network khi gõ: 0 request chứa nội dung SQL (Core Rule 7).
- AC5: E2E `workspace-persist.spec.ts` chạy thật trên Chromium: gõ → reload → so khớp.
- AC6: Giao diện không đổi so với trước task (không thêm nút, không đổi khoảng cách).

Ca biên: IndexedDB bị chặn (chế độ riêng tư) thì app vẫn chạy ở chế độ không lưu, có cảnh báo một lần; hai tab trình duyệt cùng ghi.
Giao diện: trạng thái không lưu được phải có thông báo vi/en, không chặn người dùng làm việc.
Kiểm tra: `npm run check` và `npx playwright test web/e2e/workspace-persist.spec.ts`.
Góc review thêm: đúng yêu cầu, giao diện vi/en.
Đọc thêm: `web/src/modules/lab/lab-workspace.tsx` hiện tại.
