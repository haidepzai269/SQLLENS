# Bàn giao Task146 — Renderer chỉ đọc bám prototype

Đã làm: `ReadonlyWorkspace` dựng lại màn hình 2 của `share_preview_prototype.html`: header 44px có logo SQLLens, badge "Snapshot chỉ đọc", tên dự án, chip engine; tab bar chỉ đọc (icon khoá, không nút `+`/đóng, cuộn ngang khi nhiều tab); editor CodeMirror `readOnly` có số dòng, highlight cú pháp, watermark READ_ONLY, nút "Sao chép SQL" + toast. `share.css` khoá token prototype (`--stage #0e0e10`, `--lamp #f2b84b`, `--radius 4px`), có nhánh `html.light` để theme sáng vẫn đọc được, và luật `@media print` (bỏ nền tối, bỏ nút, không cắt SQL).

Thay đổi ngoài danh sách phạm vi:
- `sql-editor.tsx` / `sql-editor-impl.tsx`: thêm prop `readOnly`. Khi bật: `EditorState.readOnly` + `EditorView.editable(false)`, luôn hiện số dòng, tắt autocomplete/ghost text/AI (ghost text AI có thể gọi mạng — Core Rule 7). Phải thêm `contentAttributes tabindex=0`: `editable(false)` làm contentDOM mất tabindex, click không focus nên **Ctrl+F và bôi đen bàn phím chết** — lỗi bắt được khi kiểm Chrome, đã sửa.
- `messages/{vi,en}/share.json`: thêm nhánh `view.*` (badge, copy, copied, copyFailed, emptyTab, noTabs, readOnlyNote, tabsLabel, editorLabel).

Kiểm tra (máy):
- `npx vitest run src/modules/share/components/readonly-workspace.test.tsx`: 8/8 PASS (header, contenteditable=false + số dòng, chuyển tab, copy thành công/thất bại, 1 tab + tên dài + 500 dòng, 0 tab/tab rỗng, en).
- `npm run check`: PASS 1.288 test (18 skip), i18n + lint + typecheck sạch; `npm run build` PASS.
- Chrome thật trên bản production: **20/20 PASS** — header/badge/tab đúng; gõ "HACK" không đổi nội dung; Ctrl+F mở `.cm-search`; chuyển tab đổi SQL; copy đúng SQL tab đang mở và đọc lại được từ clipboard; 390px không tràn ngang; vi/en; theme sáng (nền `rgb(241,242,244)`, chữ `rgb(17,24,39)`); **0 request mạng trong 2 giây sau khi snapshot đã giải mã**; 0 lỗi console. Ảnh: `share-vi-1440.png`, `share-vi-390.png`, `share-en-1440.png`, `share-light-1440.png`, `share-check.json`.

So với prototype: bám font Public Sans/JetBrains Mono, bề mặt Stage/Ground, lamp, góc 4px, header và vùng editor. Khác có chủ ý: không có cột ERD, console sandbox, nút Fork/Chạy (Task147/148), và không có dòng tác giả/ngày vì `SnapshotV1` không mang hai trường đó.

Chưa làm được / giới hạn:
- **Chưa gọi reviewer độc lập**, chưa merge.
- Theme sáng kiểm bằng đổi class `html` trên Chrome, chưa bấm qua màn Settings; Safari chưa kiểm (thiếu executable Playwright WebKit).
- CodeMirror ảo hoá dòng nên test 500 dòng chỉ xác nhận tài liệu nạp và scroller tồn tại, không đếm đủ 500 dòng trong DOM.

Phát sinh (SP999): (1) watermark READ_ONLY đè lên vùng chọn copy nếu người dùng bôi tới cuối trang — đang `pointer-events-none` nên không cản, nhưng nên dời vào góc header khi in; (2) editor đang theo `lineWrapping` của Settings người nhận, prototype không ngắt dòng — cần chốt có nên cố định cho trang share.
