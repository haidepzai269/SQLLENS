# Bàn giao Task025

Đã làm: `EngineAdapter.tryChange(change, probe)` trả `Outcome<TryChangeResult>`. Trình tự: đo `probe` trong transaction rồi ROLLBACK; BEGIN, chạy `change`, đo lại, ROLLBACK. Đo bằng `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, lấy số trang từ nút gốc và danh sách `nodeTypes`. Kết quả là `Conclusion` nhãn Thật, `evidence` chỉ có số trang trước và sau, không có thời gian. Mọi câu chạy qua `session.run` nên qua `checkUserSql` và dưới `sqllens_user`. `tryChange` không vào `history()`.
Bị từ chối trước khi chạy (`NotSimulated`, khóa `tryChange.*`): `change` có BEGIN/COMMIT/ROLLBACK/SAVEPOINT, `CREATE INDEX CONCURRENTLY`, `probe` nhiều hơn một câu, parser chưa tải (fail-closed), hoặc phiên đang có transaction mở của người dùng (hoặc đã hỏng) vì ROLLBACK sẽ hủy việc của họ.
File chính: `web/src/engines/postgres/try-rollback.ts`, `try-rollback.test.ts`, `adapter.ts`, `worker.ts`, `protocol.ts`, `guard.ts` (thêm `isGuardReady`), `web/src/contracts/engine.ts`, `web/messages/{vi,en}/tryChange.json`, `web/e2e/postgres-try-change.spec.ts`.
Kết quả kiểm tra (trong `web/`, `API_ORIGIN=http://localhost:8080`, `E2E_PORT=3125`):
- `npm run check`: thoát 0, 121 test đạt (lần đầu trượt do máy bận: `plan-data` AC5 timing 15,0 giây, `result-grid` và `try-rollback` hết 5 giây; chạy lại đạt, thêm timeout 30 giây cho test của task, không nới tiêu chí khác).
- `npm run build`: thoát 0.
- `npx playwright test e2e/postgres-try-change.spec.ts`: đạt, thoát 0 (tryChange trong worker thật, timeout rồi `rebuild()` cho checksum như trước).
Kết quả review (reviewer sonnet, 2 vòng): 1 lỗi confirmed đã sửa (ROLLBACK hủy transaction mở của người dùng), kèm 1 nit đã sửa (`await RELEASE`). Còn lại: (a) lỗi sequence, `nextval` không rollback nên probe `INSERT` vào cột serial làm sequence tiến lên (probe chạy 2 lần), checksum bảng vẫn đúng, chấp nhận như giới hạn của PostgreSQL; (b) needs_validation: `reject` cho qua `change` mà parser không đọc được (PG và parser cùng bản 18 nên chưa dựng được ca lọt).
Chưa làm được: chưa kiểm trên Vercel, Firefox, Safari. Không có giao diện (SP010).
Phát sinh:
- Lỗi cũ từ Task021, không phải do task này: `postgres-guard.spec.ts` thỉnh thoảng trả `guard.escaped` thay vì `guard.role` (1 trong 4 lần chạy cạnh test của task này), nghĩa là lớp một tắt vì `loadGuard` không tải được parser. Cùng lý do, `tryChange` có lúc trả `parserUnavailable`. Nên làm `loadGuard` thử lại và báo trạng thái, vì vá `fetch` tạm có thể đua với các tải song song.
- Sửa `worker.ts`, `protocol.ts`, `adapter.ts`, `guard.ts` (ngoài danh sách phạm vi, chỉ thêm).
- `EngineAdapter` có thêm `tryChange` bắt buộc; adapter MySQL (SP010) phải cài, bằng bảng clone.
Việc tiếp theo cần biết: SP010 dịch `reasonKey` bằng namespace `tryChange` (ví dụ `t("transaction")`), `evidence.messageKey` là `tryChange.pagesBefore` và `tryChange.pagesAfter` với biến `pages`. `plans.before/after` là JSON thô của EXPLAIN, chuẩn hóa là việc SP007. Lỗi của `change` hay `probe` được ném là `EngineError`/lỗi PGlite, giao diện phải bắt.
