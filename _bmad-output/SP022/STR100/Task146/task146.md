# Task146: Renderer chỉ đọc bám prototype

Thuộc: SP022 / STR100
Mục tiêu: Người nhận link thấy đúng sản phẩm, không phải một trang lạ, và không sửa được gì.

Phạm vi:
- `web/src/modules/share/components/readonly-workspace.tsx`
- `web/src/modules/share/components/readonly-workspace.test.tsx`
- `web/src/modules/share/share.css`
- `web/messages/vi/share.json`, `web/messages/en/share.json`

Không làm:
- Không sửa `share_preview_prototype.html`.
- Không thêm nút Lưu/Chạy vào đây (Task147, Task148 làm riêng).
- Không đổi theme chung của app.

Hợp đồng:
- Token bắt buộc: `--stage: #0e0e10`, `--lamp: #f2b84b`, `--radius: 4px`, font `Public Sans` và `JetBrains Mono`.
- CodeMirror ở chế độ `readOnly: true`, vẫn bật số dòng, highlight cú pháp, `Ctrl+F`.
- Tab bar chỉ đọc: hiện tên tab, không có nút `+` và nút đóng.

Tiêu chí xong:
- AC1: So với `_bmad-output/share_preview_prototype.html`: đúng font, màu, bán kính góc, bố cục header và vùng editor.
- AC2: Không gõ được vào editor (thử gõ, nội dung không đổi); vẫn chọn và sao chép được.
- AC3: Tab bar chuyển được giữa các tab trong snapshot, không có thao tác sửa.
- AC4: Nút "Sao chép SQL" hoạt động, có thông báo đã sao chép.
- AC5: Đủ vi/en; 390px không tràn ngang, editor vẫn cuộn được.
- AC6: Không có request mạng sau khi snapshot đã giải mã.

Ca biên: tab tên dài; snapshot 1 tab; SQL 500 dòng; theme hệ thống tối/sáng; in trang share ra giấy.
Giao diện: chạy thật cả vi và en, chụp ảnh so với prototype.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/components/readonly-workspace.test.tsx`.
Góc review thêm: giao diện (so ảnh với prototype, 390px, vi/en).
Đọc thêm: `_bmad-output/share_preview_prototype.html`.
