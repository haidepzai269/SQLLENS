# BIÊN BẢN BÀN GIAO TASK 144

- **Story:** STR099 - Mã hóa snapshot vào URL
- **Epic:** SP022 - Chia sẻ Snapshot qua URL
- **Người thực hiện:** Amelia (Senior Software Engineer subagent)
- **Người review độc lập:** Task-reviewer (Independent Reviewer subagent)
- **Trạng thái:** HOÀN THÀNH 100% - ĐÃ NGHIỆM THU PASS VÒNG 1
- **Thời điểm nghiệm thu:** 2026-11-19

---

## 1. Mục tiêu & Hợp đồng kỹ thuật
Hiện thực hóa giao diện Share Dialog cho phép người dùng chia sẻ snapshot workspace qua URL fragment (`#d=...`) hoặc file `.sqllens` trong một cú bấm, minh bạch hoàn toàn về quyền riêng tư và độ dài link:
- **Component:** `<ShareDialog disabled={...} />` tại `web/src/modules/share/components/share-dialog.tsx`.
- **Nút bấm:** Gắn trên thanh header của Stage (`stage.tsx`) cạnh nút `ExportMenu`.
- **Định dạng liên kết:** `${origin}/${locale}/share#d=${payload}` với payload nén gzip + base64url từ Task 143.
- **3 trạng thái kích thước:**
  - `ok` (< 8KB): Input URL readonly + nút "Sao chép".
  - `warn` (8KB–32KB): Cảnh báo màu vàng liên kết dài có thể bị cắt trên các ứng dụng chat (Slack/Discord/Zalo...), vẫn cho sao chép và kèm nút "Tải file .sqllens".
  - `blocked` (> 32KB hoặc `SNAPSHOT_TOO_LARGE`): Cảnh báo màu đỏ vượt quá giới hạn an toàn 32KB, chặn tạo link, chỉ cung cấp nút "Tải file .sqllens".
- **Cảnh báo quyền riêng tư:** Luôn hiển thị cố định ở đầu Dialog ở mọi trạng thái (`ok`, `warn`, `blocked`), không bị ẩn sau tooltip (AC2).
- **Sao chép an toàn:** Dùng `navigator.clipboard.writeText`, tự động fallback sang `input.select()` khi trình duyệt chặn quyền; nút chuyển "Đã sao chép!" trong 2s.
- **Tải file `.sqllens`:** Định dạng JSON `SnapshotV1` chuẩn, tải client-side qua Blob, tên file `<tên dự án>-snapshot-<YYYYMMDD-HHmm>.sqllens`.
- **0 Byte ra mạng:** 100% xử lý client-side, tuân thủ tuyệt đối Core Rule 7.

---

## 2. Danh sách file thay đổi
1. `web/messages/vi/share.json`: Bản dịch tiếng Việt 10 key chuẩn (`title`, `buttonLabel`, `copy`, `copied`, `warningPrivacy`, `warningLength`, `blocked`, `download`, `downloadHint`, `close`).
2. `web/messages/en/share.json`: Bản dịch tiếng Anh tương ứng 1-1.
3. `web/src/modules/share/components/share-dialog.tsx`: Hộp thoại ShareDialog, helper `buildSnapshotFromStore`, quản lý 3 trạng thái kích thước, copy clipboard + fallback, tải file snapshot.
4. `web/src/modules/share/components/share-dialog.test.tsx`: Bộ 22 unit test bao phủ toàn diện AC1–AC6 và các ca biên.
5. `web/src/modules/lab/stage/stage.tsx`: Tích hợp `<ShareDialog />` vào thanh header của Stage.

---

## 3. Kết quả nghiệm thu theo tiêu chí (AC)

| Tiêu chí | Mô tả | Kết quả | Bằng chứng kiểm thử |
|---|---|---|---|
| **AC1** | Tạo URL `#d=...`, sao chép link, hiện "Đã sao chép" | **PASS** | URL tạo đúng `${origin}/${locale}/share#d=${payload}`, copy vào clipboard thành công, nút chuyển "Đã sao chép!" và phục hồi sau 2s. |
| **AC2** | Luôn hiển thị cảnh báo quyền riêng tư ở mọi trạng thái | **PASS** | `share-privacy-warning` hiển thị cố định trên thân dialog ở cả 3 trạng thái `ok`, `warn`, `blocked`, không bị ẩn sau tooltip. |
| **AC3** | 8–32KB cảnh báo chat app; > 32KB chặn link và cho tải file | **PASS** | 8–32KB render cảnh báo vàng `~{size} KB`; > 32KB ẩn input URL/nút copy và hiển thị nút "Tải file .sqllens". |
| **AC4** | 0 request mạng khi tạo link và sao chép | **PASS** | SpyOn `fetch` và `XMLHttpRequest`: 0 network call, 100% xử lý trong RAM client-side (Core Rule 7). |
| **AC5** | Tải file `.sqllens` ra JSON đúng `SnapshotV1`, giải mã được | **PASS** | Tên `<tên dự án>-snapshot-<YYYYMMDD-HHmm>.sqllens`, cấu trúc `SnapshotV1` giải mã ngược lại khớp 100% dữ liệu gốc. |
| **AC6** | Bản dịch vi/en đầy đủ, bàn phím điều hướng, 390px không tràn | **PASS** | Đầy đủ bản dịch, xử lý phím Esc/Tab/trả focus chuẩn Radix Dialog, responsive mobile 390px không tràn ngang. |

### Ca biên (Edge cases)
- Workspace 100 tabs: Tạo snapshot và mã hóa mượt mà, không lag/đơ.
- Clipboard API bị chặn: Tự động fallback sang `input.select()` cho người dùng bấm `Ctrl+C`.
- Tên dự án có ký tự cấm, tiếng Việt có dấu: Làm sạch thành tên file hợp lệ.
- Đang chạy query: Nút Share bị disabled qua prop `disabled={working}`.

---

## 4. Kiểm tra chất lượng bằng máy
- `npx vitest run src/modules/share/components/share-dialog.test.tsx`: 22/22 passed.
- `npx vitest run src/modules/share/`: 45/45 passed (23 codec + 22 share-dialog).
- `npm run check:i18n`: PASS (0 errors).
- `npx eslint src/modules/share/`: PASS (0 errors).
- `npx tsc --noEmit`: PASS (0 errors).
- `npm run check`: PASS (1.250 tests passed trên toàn dự án).
- `npm run build`: PASS (57/57 static pages).

---

## 5. Kết luận
Task 144 hoàn thành xuất sắc và đã được nghiệm thu độc lập PASS 100%.
**CHÍNH THỨC HOÀN TẤT 100% TOÀN BỘ STORY STR099!**
Sẵn sàng tích hợp vào `main` và tiếp tục với Story STR100 (Task 145: Route `/share` đọc fragment, trạng thái lỗi, chặn referrer).
