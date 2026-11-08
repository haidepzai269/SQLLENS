# Task079: Tiêu chí hỏng tùy biến cho Conflict Sim

Thuộc: SP011 / STR052
Mục tiêu: Kịch bản tranh chấp mẫu có sẵn điều kiện hỏng mặc định; người dùng có thể tự viết thêm hoặc chỉnh sửa bằng câu lệnh SELECT và toán tử so sánh, hoặc tắt tiêu chí để chỉ theo dõi bế tắc (deadlock) và hàng đợi chờ khóa.

Phạm vi:
- `web/src/modules/conflict-sim/engine/types.ts` (mở rộng `Scenario.brokenCheck` thành optional/null, bổ sung outcome `no_criteria`)
- `web/src/modules/conflict-sim/engine/simulate.ts` (xử lý khi không có brokenCheck, evaluate custom brokenCheck an toàn)
- `web/src/modules/conflict-sim/engine/simulate.test.ts` (unit tests cho simulate với custom brokenCheck và không có brokenCheck)
- `web/src/modules/conflict-sim/ui/model.ts` (thêm `CustomCheck` trong `Cfg`, hàm `defaultCheckFor`, xử lý simulateCfg)
- `web/src/modules/conflict-sim/ui/model.test.ts` (unit tests cho model với custom criteria)
- `web/src/modules/conflict-sim/ui/conflict-panel.tsx` (khu vực điều khiển Tiêu chí hỏng: toggle, ô nhập SELECT, toán tử, giá trị, nút Khôi phục mặc định, hiển thị kết quả)
- `web/messages/{vi,en}/conflictSim.json` (bản dịch song ngữ cho tiêu chí hỏng và outcome mới)
- `web/e2e/conflict-criteria.spec.ts` (hoặc mở rộng `web/e2e/conflict-sim.spec.ts` kiểm thử E2E)

Không làm:
- Tranh chấp MySQL hai connection thật (STR050).
- Chạy DDL / DML tùy ý trong câu lệnh kiểm tra (chặn đứng mọi lệnh ngoài `SELECT`).
- Đưa ra kết luận chủ quan "thiết kế này ổn" khi không có tiêu chí (Nguyên tắc 2: chỉ báo không phát hiện deadlock/serialization failure trong kịch bản này).

Hợp đồng:
- `BrokenCheck`: `{ sql: string; brokenWhen: string }`
- `CustomCheck`: `{ enabled: boolean; sql: string; op: "=" | "<>" | ">" | "<" | ">=" | "<="; target: number }`
- `TimelineOutcome`: `"broken" | "not_broken" | "deadlock" | "serialization_failure" | "no_criteria"`
- Khi `enabled === false` hoặc `brokenCheck == null`:
  - Simulator vẫn chạy đủ tất cả các bước của Session A và Session B.
  - Vẫn phát hiện `waiting` (chờ khóa), `deadlock` (mã 40P01), `serialization_failure` (mã 40001).
  - Nếu không xảy ra deadlock / lỗi tuần tự: kết quả trả về `outcome: "no_criteria"`.
- Khi `enabled === true`:
  - `sql` phải parse thành công dưới dạng `select` bằng `parseSql`. Nếu không parse được hoặc là lệnh ghi dữ liệu: ném lỗi `notSim("unsupportedSql")` hoặc thông báo lỗi cú pháp rõ ràng.
  - `brokenWhen` có dạng `<op> <target>` (ví dụ `<> 130`, `= 0`, `> 1`).
  - Đánh giá giá trị thực tế sau khi transaction kết thúc để xác định `broken` hay `not_broken`.

Tiêu chí xong:
- AC1: 5 kịch bản mẫu khi chọn đều nạp sẵn câu lệnh `SELECT` kiểm tra và điều kiện hỏng mặc định tương ứng (Lost update: `SELECT balance FROM accounts WHERE id = 1` `<> 130`; Write skew: `SELECT count(*) FROM doctors WHERE on_call = true` `= 0`; Double booking: `SELECT count(*) FROM bookings WHERE slot = 1` `> 1`; Deadlock: `SELECT balance FROM accounts WHERE id = 1` `<> 100`; Non-repeatable read: `differs_within_tx`).
- AC2: Người dùng có thể bật/tắt checkbox kiểm tra tiêu chí dữ liệu. Khi tắt (`enabled = false`), các trường nhập câu lệnh bị vô hiệu hóa hoặc ẩn gọn, kèm dòng giải thích rõ: mô hình chỉ theo dõi chờ khóa và deadlock.
- AC3: Khi tắt kiểm tra dữ liệu, kịch bản chạy hết các nhịp sẽ hiển thị kết luận mang nhãn `no_criteria` (nếu không có deadlock hay serialization failure), thông báo rõ ràng rằng không đặt tiêu chí kiểm tra dữ liệu và không phát hiện bế tắc.
- AC4: Người dùng có thể sửa câu lệnh `SELECT`, chọn toán tử so sánh (`=, <>, >, <, >=, <=`) và sửa giá trị ngưỡng. Kết quả quan sát (`observed`) và trạng thái hỏng/không hỏng cập nhật chính xác theo tiêu chí mới.
- AC5: Có nút "Khôi phục mặc định" (`Reset to default`) để đưa tiêu chí kiểm tra trở về đúng giá trị ban đầu của kịch bản đã chọn. Đổi sang kịch bản khác tự động chuyển về tiêu chí mặc định của kịch bản đó.
- AC6: An toàn (Nguyên tắc 8): Câu lệnh kiểm tra chỉ chấp nhận `SELECT`. Chặn mọi hành vi thay đổi dữ liệu (DML/DDL). Không ghi log SQL của người dùng (Nguyên tắc 7). Nhãn kết luận luôn là `Mô phỏng` (`simulated`).
- AC7: Giao diện chuẩn shadcn/ui, responsive hoàn hảo trên màn hình desktop 1440px và di động 390px. Đầy đủ song ngữ tiếng Việt & tiếng Anh.
- AC8: `npm run check` thoát 0, `npm run build` thoát 0, unit tests vitest và Playwright E2E tests pass 100%.

Ca biên:
- Người dùng xóa trắng câu lệnh SELECT hoặc gõ cú pháp không hợp lệ: Báo lỗi thân thiện hoặc rơi về trạng thái `Chưa mô phỏng được` (`NotSimulated`) mà không làm sập (crash) giao diện.
- Giá trị mục tiêu là số âm, số 0 hoặc số rất lớn: Xử lý đúng kiểu số nguyên/thực mà không bị lỗi NaN.
- Kịch bản deadlock khi tắt tiêu chí kiểm tra: Vẫn phát hiện deadlock bình thường (outcome `deadlock`) và hiển thị chu trình chờ khóa trong Cytoscape graph.

Kiểm tra:
`cd web && npm run check && npm run build && npx playwright test`

Góc review thêm:
- Nhãn kết luận (nguyên tắc 1: Mô phỏng).
- Nguyên tắc 2: Không nói "thiết kế này ổn" khi ở trạng thái `no_criteria`.
- Bảo mật SQL (nguyên tắc 8: chỉ chấp nhận SELECT hợp lệ).
- i18n song ngữ và responsive 390px.
