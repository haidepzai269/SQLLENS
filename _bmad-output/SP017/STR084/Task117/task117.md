# Task117: Bộ Điều Phối Ưu Tiên (Precedence Dispatcher) CodeMirror 6

Thuộc: SP017 / STR084
Mục tiêu: Khắc phục triệt để lỗi tranh chấp phím và render chồng đè giữa Dropdown Popup, Local Inline Ghost Text và AI Copilot Ghost Text (BUG-SP016-05):
1. Nhường quyền phím `Tab` và `Enter` cho Dropdown Popup khi popup đang mở (`completionStatus(view.state) === "active"`).
2. Xây dựng cơ chế ưu tiên: Local Ghost Text ưu tiên trước AI Ghost Text khi nhấn `Tab`.
3. Cơ chế triệt tiêu lẫn nhau (Mutual Exclusion):
   - Khi Local Heuristics có gợi ý (0ms) -> Hủy bỏ timer debounce và abort request in-flight của AI Copilot.
   - Khi AI Ghost Text trả về -> Chống render chồng đè, không bao giờ vẽ 2 widget ghost text cùng lúc tại con trỏ.
4. Phím `Escape` hủy sạch cả Local và AI Ghost Text.

Phạm vi:
- `web/src/components/sql-editor/extensions/inline-ghost-text.ts`
- `web/src/components/sql-editor/extensions/ai-copilot.ts`
- `web/src/components/sql-editor/extensions/inline-ghost-text.test.ts`
- `web/src/components/sql-editor/extensions/ai-copilot.test.ts`
- Có thể bổ sung helper dispatcher nếu cần, hoặc đồng bộ hóa trực tiếp trong hai extension.

Không làm:
- Không sửa logic Heuristics (đã hoàn thiện ở Task116).
- Không sửa backend Gin hay Upstash Redis (Task118 phụ trách).

Hợp đồng:
- Khi `completionStatus(view.state) === "active"`:
  - `acceptGhostText(view)` trả về `false`.
  - `acceptAiGhostText(view)` trả về `false`.
- Khi `completionStatus(view.state) !== "active"`:
  - Nếu `ghostTextField` có text -> `acceptGhostText` chèn local text, `return true`.
  - Nếu `aiGhostTextField` có text và không có local text -> `acceptAiGhostText` chèn AI text, `return true`.
- Khi hiển thị decorations:
  - `aiGhostTextDecorations` kiểm tra `state.field(ghostTextField, false)?.text`: nếu local đang hiển thị, trả về `Decoration.none` để triệt tiêu hiện tượng render đè 2 widget.
- Trong `AiCopilotPluginValue`:
  - Trong phương thức `update(viewUpdate)`: nếu `viewUpdate.state.field(ghostTextField, false)?.text`, tự động clear debounce timer và abort fetch in-flight.

Tiêu chí xong:
- AC1: Khi Dropdown autocomplete đang mở (`completionStatus(view.state) === "active"`), nhấn `Tab` không kích hoạt `acceptGhostText` hay `acceptAiGhostText`, nhường quyền chọn item cho autocomplete popup.
- AC2: Khi Dropdown đóng, nếu có Local Ghost Text thì nhấn `Tab` chấp nhận Local Ghost Text.
- AC3: Khi Dropdown đóng và không có Local Ghost Text, nếu có AI Ghost Text thì nhấn `Tab` chấp nhận AI Ghost Text.
- AC4: Khi Local Heuristics sinh ra gợi ý (0ms), AI Copilot hủy timer debounce và abort request in-flight, không gửi API call vô ích.
- AC5: Đảm bảo không bao giờ render đồng thời cả 2 widget ghost text tại cùng một vị trí con trỏ (chống chữ mờ đè nhau).
- AC6: Nhấn `Escape` hủy bỏ cả Local Ghost Text lẫn AI Ghost Text sạch sẽ.
- AC7: Toàn bộ unit tests trong `inline-ghost-text.test.ts` và `ai-copilot.test.ts` PASS 100%, `npm run check` không có lỗi.

Kiểm tra: `cd web; npm run check; npx vitest run src/components/sql-editor/extensions/`
Góc review thêm: Kiểm tra tương tác với `@codemirror/autocomplete` và tính an toàn của CodeMirror StateField.
Đọc thêm: `_bmad-output/SPEC_VA_LOI_SP016.md` mục 2 (BUG-SP016-05) và mục 3 (STR084).
