# Task139: Xuất ERD thành PNG

Thuộc: SP021 / STR097
Mục tiêu: Người dùng tải được ảnh sơ đồ bảng sạch, không dính nút điều khiển, để dán vào tài liệu.

Phạm vi:
- `web/src/modules/export/capture/erd-png.ts`
- `web/src/modules/export/capture/erd-png.test.ts`
- `web/src/modules/export/components/export-menu.tsx` (thêm mục PNG)
- `web/messages/vi/export.json`, `web/messages/en/export.json`

Không làm:
- Không chụp cây B-Tree (Task140).
- Không đổi giao diện sơ đồ hiện có.
- Không gọi dịch vụ chụp ảnh bên ngoài.

Hợp đồng:
- `captureErdPng({ scale = 2 }): Promise<Blob>` chụp đúng phần tử `.react-flow__viewport`, ẩn `.react-flow__minimap` và `.react-flow__controls` trong lúc chụp.
- Tiến trình báo qua callback `onProgress?: (step: "prepare" | "capture" | "encode") => void`.
- Thư viện `modern-screenshot` do phiên chính thêm.

Tiêu chí xong:
- AC1: Ảnh PNG không chứa minimap, không chứa nút zoom, không có viền ngoài thừa.
- AC2: Ảnh đúng độ phân giải scale 2 (kích thước pixel gấp đôi CSS).
- AC3: Sơ đồ 50 bảng xuất xong, UI vẫn phản hồi và có tiến trình hiển thị.
- AC4: Tab sơ đồ đang ẩn (`display: none`) vẫn chụp ra ảnh đúng, không ra ảnh trắng.
- AC5: Theme sáng và tối đều cho ảnh đọc được (chữ không mất màu).
- AC6: Không có request mạng nào; ảnh không rời máy.

Ca biên: sơ đồ 1 bảng; sơ đồ có node đang kéo dở; zoom 30% và 200%; màn hình 390px.
Giao diện: tiến trình và thông báo lỗi vi/en; nút disable khi sơ đồ rỗng.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/export/capture/erd-png.test.ts`.
Góc review thêm: giao diện (chụp thật, so ảnh), đúng yêu cầu.
Đọc thêm: `web/src/modules/lab/stage/` (tab sơ đồ), `_bmad-output/SP021/STR096/Task138/task138.md`.
