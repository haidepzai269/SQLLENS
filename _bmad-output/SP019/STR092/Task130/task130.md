# Task130: Nhập nháp khách vào tài khoản khi đăng nhập

Thuộc: SP019 / STR092
Mục tiêu: Người dùng thử trước khi đăng ký không mất bài đang làm khi đăng nhập.

Phạm vi:
- `web/src/modules/workspace/import-guest.ts`
- `web/src/modules/workspace/import-guest.test.ts`
- `web/src/modules/workspace/components/import-guest-banner.tsx`
- `web/messages/vi/workspace.json`
- `web/messages/en/workspace.json`

Không làm:
- Không tự động nhập (phải do người dùng bấm).
- Không đụng scope guest (không xóa, không đổi).
- Không đẩy gì lên cloud.

Hợp đồng:
- `hasGuestDrafts(): Promise<boolean>`
- `importGuestDrafts(userId: string): Promise<{ projects: number; tabs: number }>`
- Key i18n: `guestImport.title`, `guestImport.action`, `guestImport.dismiss`, `guestImport.done`.

Tiêu chí xong:
- AC1: Đăng nhập lần đầu trên máy có nháp guest thì hiện banner một lần mỗi phiên.
- AC2: Bấm nhập thì nhân bản toàn bộ project và tab sang scope `user_<uuid>` với id mới, bản guest giữ nguyên.
- AC3: Nhập xong hiện toast số project/tab đã nhập; banner biến mất.
- AC4: Bấm bỏ qua thì không hiện lại trong cùng phiên, hiện lại ở phiên sau nếu guest vẫn còn nháp.
- AC5: Nhập hai lần không tạo bản trùng (chặn bằng cờ đã nhập cho cặp guest-user).
- AC6: Đủ vi/en; banner không che editor, đọc được 390px.

Ca biên: guest có 50 tab; guest rỗng; IndexedDB đầy giữa lúc nhập (báo rõ, không mất bản guest).
Giao diện: banner có 2 nút (Nhập / Bỏ qua), không tự động chiếm focus.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/import-guest.test.ts`.
Góc review thêm: giao diện vi/en, đúng yêu cầu.
Đọc thêm: `_bmad-output/SP019/STR092/Task129/task129.md`.
