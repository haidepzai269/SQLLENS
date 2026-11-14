# Bàn giao Task 110: Extension CodeMirror 6 Inline Ghost Text: Render chữ mờ xám sau con trỏ, phím Tab nhận và Esc hủy

## 1. Thông tin chung
- **Task:** Task 110 - Extension CodeMirror 6 Inline Ghost Text: Render chữ mờ xám sau con trỏ, phím Tab nhận và Esc hủy
- **Story:** STR078 - Trợ Lý Gợi Ý Viết Tiếp Cục Bộ (Code-based Inline Ghost Text - Mặc định BẬT)
- **Epic:** SP016 - Smart Editor, User Tiering & Terminal AI Diagnosis
- **Người thực hiện:** Amelia (Developer)
- **Reviewer độc lập:** Task Reviewer độc lập (Subagent ID `fe9798b3-2153-4e5e-9d29-e14ff77c02aa`)
- **Worktree:** `C:\SQLLens-task110` (branch `task/Task110`)
- **Commit triển khai:** `ecc0d42dd2fdd049558a428b848262f298736352`
- **File đặc tả:** `_bmad-output/SP016/STR078/Task110/task110.md`

---

## 2. Các file đã tạo mới & thay đổi
1. `web/src/components/sql-editor/extensions/inline-ghost-text.ts`:
   - Xây dựng extension CodeMirror 6 hoàn chỉnh kết nối StateField, Facet cấu hình schema/FKs, và EditorView decorations.
   - Định nghĩa `GhostTextWidget` render thẻ `<span>` với class CSS:
     `opacity-40 select-none pointer-events-none text-muted-foreground font-mono inline-block` kèm `aria-hidden="true"`.
   - Gán `keymap` với độ ưu tiên cao nhất (`Prec.highest`):
     + `Tab`: Khi có Ghost Text -> chèn gợi ý vào tài liệu tại `from`, dời cursor đến cuối chuỗi, xóa ghost text, return `true`. Khi không có Ghost Text -> return `false` (thụt lề 2 spaces bình thường, không nuốt phím).
     + `Escape`: Khi có Ghost Text -> hủy bỏ ngay lập tức, return `true`. Khi không có -> return `false`.
   - Xử lý Type-ahead: gõ đúng ký tự tiếp theo thì tự động cắt ngắn chuỗi gợi ý đi 1 ký tự (`ghost.text.slice(1)`), hỗ trợ cả gõ case-insensitive; gõ lệch, xóa lùi, hoặc paste -> tự động tính toán lại với động cơ Heuristics (Task 109).
   - Khi có vùng bôi đen (`!selection.main.empty`) hoặc click chuột di chuyển con trỏ -> tự động hủy bỏ ghost text.
   - Khi `enabled === false`: trả về mảng rỗng `[]` (zero CPU/RAM overhead).
2. `web/src/components/sql-editor/extensions/inline-ghost-text.test.ts`:
   - 18 unit tests toàn diện bao phủ 100% các tiêu chí AC1, AC2, AC3, AC4, AC5 và các ca biên (doc rỗng, schema rỗng, paste, type-ahead gõ hết, cursor di chuyển).
3. `web/src/components/sql-editor/sql-editor.tsx` & `sql-editor-impl.tsx`:
   - Bổ sung prop `foreignKeys?: ForeignKeyRelation[]` và `ghostTextEnabled?: boolean`.
   - Kết nối `isGhostTextEnabled = ghostTextEnabled ?? settings.ghostTextEnabled` (mặc định BẬT - `true`).
   - Tích hợp `inlineGhostText` vào pipeline `extensions` của CodeMirror.
4. `web/src/components/sql-editor/sql-editor-impl.test.tsx`:
   - Cập nhật test suite, bổ sung kiểm thử tiếp nhận prop `foreignKeys` và bật/tắt `ghostTextEnabled` an toàn.
5. `web/src/modules/lab/lab-workspace.tsx`:
   - Quản lý state `foreignKeys: ForeignKeyRelation[]`.
   - Trong `refreshTables(db)`: tự động trích xuất danh sách khóa ngoại từ `tableInfos` (duyệt `c.references`) và cập nhật vào state.
   - Reset sạch `foreignKeys: []` khi chuyển engine, khi bấm `fresh()` PGlite Sandbox và khi `fresh()` MySQL Container.
   - Truyền `foreignKeys={foreignKeys}` vào `<SqlEditor />`.

---

## 3. Kết quả kiểm tra bằng máy
- `npx vitest run src/components/sql-editor/extensions/inline-ghost-text.test.ts`: **18/18 tests PASS** (560ms).
- `npx vitest run src/components/sql-editor`: **5 test files, 47 tests PASS**.
- `npm run check:i18n`: **PASS (0 lỗi)**.
- `npm run lint`: **PASS (0 errors, eslint sạch)**.
- `npm run typecheck`: **PASS (tsc --noEmit 0 errors)**.
- `npx vitest run`: **PASS 100% (76 test files, 798 tests passed, 0 failed, 16 skipped)**.

---

## 4. Ý kiến của Reviewer độc lập
- **Đánh giá:** **PASS 100% (CHẤP THUẬN NGHIỆM THU)**.
- Extension được cấu trúc rất chuẩn mực, tận dụng triệt để StateField và Facet của CodeMirror 6.
- Hành vi phím tắt `Tab` và `Escape` được kiểm soát chặt chẽ, không gây xung đột thụt lề hay nuốt phím.
- Cơ chế Type-ahead mượt mà, phản hồi tức thì 0ms mà không tiêu tốn API token hay tài nguyên mạng.

---

## 5. Việc phát sinh đưa vào SP999
- Không có lỗi hay nợ kỹ thuật phát sinh.
