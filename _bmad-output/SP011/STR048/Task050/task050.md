# Task050: Lõi giả lập tranh chấp PostgreSQL

Thuộc: SP011 / STR048
Mục tiêu: Giả lập 5 kịch bản tranh chấp giữa hai session của PostgreSQL theo từng nhịp, vì PGlite chỉ có một kết nối. Kết quả phải khớp Postgres thật, Task051 đối chiếu.
Phạm vi: `web/src/modules/conflict-sim/engine/**`.
Không làm: giao diện (STR051), đối chiếu Postgres thật (Task051), MySQL (STR050).

Hợp đồng:
- Năm kịch bản: `lost_update`, `deadlock_reverse_order`, `write_skew`, `double_booking`, `non_repeatable_read`. Không có dirty read, vì PostgreSQL không có hiện tượng này.
- `type Step = { session: "A" | "B"; sql: string }`, `type Scenario = { id: string; isolation: "read_committed" | "repeatable_read" | "serializable"; setup: string[]; steps: Step[]; brokenCheck: { sql: string; brokenWhen: string } }`.
- `SCENARIOS: Record<ScenarioId, Scenario>` có SQL thật chạy được trên Postgres.
- `simulate(scenario: Scenario): Timeline`. `Timeline = { ticks: Tick[]; outcome: "broken" | "not_broken" | "deadlock" | "serialization_failure" }`. Mỗi `Tick` có session, câu, trạng thái (`ran`, `waiting`, `resumed`, `error`), khóa đang giữ và chờ, snapshot mà session nhìn thấy, và `messageKey` giải thích.
- Kết quả là `Conclusion` nhãn Mô phỏng. Hàm thuần, không phụ thuộc trình duyệt và PGlite.
- Mô hình đủ cho 5 kịch bản ở 3 mức cô lập, không viết một engine SQL tổng quát. Câu ngoài mô hình trả `NotSimulated`, không đoán.

Tiêu chí xong:
- AC1: `lost_update` ở `read_committed`: mất một lần cập nhật, `outcome: "broken"`. Ở `repeatable_read`: session sau gặp lỗi `could not serialize access`, `outcome: "serialization_failure"`.
- AC2: `deadlock_reverse_order`: `outcome: "deadlock"`, có tick chờ khóa của cả hai bên. Không giả định bên nào bị hủy cố định: hợp đồng phải nói rõ mô hình chọn bên nào và Task051 chỉ so việc có deadlock.
- AC3: `write_skew` ở `repeatable_read` thì hỏng. Ở `serializable` thì lỗi serialization.
- AC4: `double_booking` ở `read_committed` thì hỏng. Khi có ràng buộc `UNIQUE` hoặc `SELECT ... FOR UPDATE` thì không hỏng.
- AC5: `non_repeatable_read` ở `read_committed` đọc hai lần khác nhau, ở `repeatable_read` giống nhau.
- AC6: Tua được: `ticks` đủ thông tin dựng lại trạng thái tại mọi nhịp, không phải chạy lại.
- AC7: Không có kết quả mang nghĩa "thiết kế ổn": `not_broken` chỉ nói kịch bản này không hỏng ở mức cô lập này. Câu ngoài mô hình trả `NotSimulated`.
- AC8: `npm run check` thoát với mã 0.

Ca biên: `simulate` chạy hai lần cho cùng kết quả; kịch bản rỗng; `steps` có session không tồn tại.
Kiểm tra: `cd web && npm run check`
Góc review thêm: nhãn kết luận, đúng hành vi PostgreSQL.
Đọc thêm: `CLAUDE.md` nguyên tắc 1, 2, 4 và mục "Khác biệt giữa hai engine"; tài liệu PostgreSQL về Transaction Isolation, tra trên web, không đoán.
