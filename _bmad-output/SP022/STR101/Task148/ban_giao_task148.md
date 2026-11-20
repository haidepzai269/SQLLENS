# Bàn giao Task148 — Chạy thử snapshot ngay trên trang share

Đã làm: trang `/share` có nút **Chạy thử**. Người nhận link bấm là câu SQL của tab đang mở chạy thật ngay trong trình duyệt của họ (PGlite cho PostgreSQL, SQLite WASM cho SQLite), kết quả hiện ở vùng kết quả dưới editor kèm nhãn **Thật**. Không cần tài khoản, không cần backend, 0 byte SQL rời khỏi máy. Snapshot MySQL không tự mở container: nút Chạy báo rõ cần sandbox trên máy chủ và chỉ đường "thêm vào workspace rồi chạy trong phòng lab".

File chính:
- `web/src/modules/share/try-run.ts` — `runSnapshotTab(tab, engine, options)`: dựng một phiên mới cho mỗi lần chạy, chạy `setupSql` (các tab đứng trước) rồi câu của tab đang mở, trả `{ kind:"result", label:"real", statements, fields, rows, totalRows, truncated, affectedRows }` hoặc `{ kind:"needs_sandbox" }` / `{ kind:"empty" }`; ném `SnapshotRunError` với mã `timeout | cancelled | sql | load_failed | worker_crashed | guard`. Hạn câu SQL 1.500 ms, huỷ bằng `AbortSignal`, phiên bị `dispose()` trong `finally` nên không rò worker.
- `web/src/modules/share/components/readonly-workspace.tsx` — nút Chạy ở header (trước nút Fork) và `RunPanel` cao cố định 186 px ở đáy cột SQL: trạng thái `idle | busy | done | error | sandbox | empty`, thanh tiến trình tải WASM, nút Hủy khi đang chạy, nút Ẩn kết quả, bảng kết quả chia 100 dòng/trang, nhãn `Thật` bằng `ConclusionBadge` chuẩn của dự án.
- `web/messages/{vi,en}/share.json` — 27 chuỗi mới cho cả hai ngôn ngữ.

Quyết định kỹ thuật đáng biết:
- **Nhãn `"real"` chứ không phải `"that"`.** Task ghi `label: "that"`, nhưng hợp đồng chung của dự án là `EvidenceLabel = "real" | "simulated" | "estimated"` (`web/src/contracts/conclusion.ts`) và `ConclusionBadge` dịch `real` thành **Thật**. Dùng `"that"` sẽ phải nới hợp đồng chung hoặc bịa một nhãn thứ tư; chọn theo hợp đồng chung, giao diện vẫn hiện đúng chữ "Thật".
- **Mỗi lần chạy một phiên mới.** Bấm Chạy 5 lần không dính lỗi "bảng đã tồn tại" của lần trước, và câu treo bị ngắt không để lại phiên hỏng.
- **`setupSql` chạy các tab phía trước trên cùng phiên.** Nếu không, tab `03_query.sql` của một snapshot sẽ báo "relation does not exist" vì bảng do tab `01_schema.sql` tạo.
- **Trần 2.000 dòng giữ lại** (`MAX_SNAPSHOT_RESULT_ROWS`); `totalRows` vẫn đếm đủ. Kết quả 100k dòng không nhồi 100k dòng qua structured clone và vào DOM.

Kết quả kiểm tra (máy):
- `npx vitest run src/modules/share`: 120/120 PASS (22 test mới cho `try-run`, 18 test mới cho vùng kết quả; nhánh SQLite chạy **WASM thật** trong Node, không mock).
- `npm run check`: PASS 1.370 test (18 skip), i18n + lint + typecheck sạch. Còn 1 warning lint `'hist' is assigned a value but never used` ở `web/e2e/plan-explain.spec.ts:21` — **có sẵn trên `main`, không phải của task này**.
- `next build`: PASS. `npx playwright test e2e/share-run.spec.ts` trên Chromium thật, bản `next build` + `next start`: **10/10 PASS**. Bằng chứng ở `run-*.png` (6 ảnh) cùng thư mục này.

Kết quả review: reviewer độc lập báo **FAIL** ở vòng 1 với 2 lỗi thật, đã sửa cả hai:
1. **Nút Hủy là nút chết trong lúc nạp WASM** (AC5). `try-run.ts` chỉ gọi `db.cancel()` khi adapter đã có, mà `create()` không nhận signal, nên bấm Hủy giữa lúc tải thì phải chờ tải xong (reviewer đo: bấm Hủy ở 223 ms, phải chờ thêm 23.907 ms). Nay `create()` được đua với tín hiệu hủy (`Promise.race`); adapter về muộn vẫn bị `dispose()` để không rò worker. Có test mới **đã chứng minh là fail trên code cũ** (10.020 ms > hạn 2.000 ms) và PASS trên code mới; E2E mới chặn `*.wasm` trễ 10 giây rồi bấm Hủy — dừng dưới 2 giây trên Chromium thật.
2. **Lỗi rào chắn hiện chuỗi thô tiếng Anh của engine** (AC7). `guardReasonKey` được set nhưng UI không dùng, nên người xem Việt thấy "Statement 1 blocked (guard.role)" hoặc "SQLite guard". Nay dịch qua `guard.json` (đúng namespace phòng lab đang dùng), có test cho cả `guard.role` và `guard.sqlite.attach`, và test khẳng định chuỗi thô không còn xuất hiện.

Sửa thêm 3 điểm reviewer ghi ở mục "Ghi chú" (không phải lỗi AC):
- Tách nhãn trạng thái thành 3 giai đoạn `loading` (tải WASM) → `starting` (khởi tạo engine) → `running` (chạy SQL) bằng callback `onExecuting` mới, thay vì báo "Đang chạy…" ngay từ lúc còn đang nạp.
- Dòng trạng thái ở tiêu đề panel và tiêu đề trong phần thân nay cùng một câu cho trạng thái rào chắn (trước đó một bên nói "không chạy được", một bên nói "bị rào chắn chặn").
- 2 test reviewer chỉ ra là "không thể fail" đã viết lại: AC6 cài bẫy `localStorage`/`sessionStorage` giả để bắt mọi lần ghi; ca "bấm 5 lần" chạy tuần tự đúng như UI (nút tự khóa) thay vì 5 lần song song.

**Vòng 2: PASS.** Reviewer kiểm lại đúng hai lỗi và diff `e8c4272..7ed9ccb`, xác nhận bằng số đo trên Chromium thật:
- Lỗi 1: chặn `*.wasm` trễ 10 giây rồi bấm Hủy — trước sửa `busy` 23.907 ms, sau sửa **114 ms** là ra `error` với "Đã hủy câu đang chạy."; chạy lại sau đó ra `done` đúng dữ liệu, không kẹt trạng thái.
- Lỗi 2: SQLite `ATTACH` và Postgres `SET ROLE` đều hiện câu giải thích tiếng Việt đúng, `{index}` = 1 đúng, bản `en` cũng đúng; hết chuỗi "SQLite guard" / "Statement 1 blocked (guard.role)".
- `onExecuting` (thay đổi ngoài 2 lỗi) không làm sai `statements`: thứ tự giai đoạn đo bằng MutationObserver là `loading → starting → running → done`, số câu vẫn "3 câu đã chạy".
- Không hồi quy: `check-i18n` 0, `tsc` 0, `eslint` 0, `vitest src/modules/share` 120/120, `playwright e2e/share-run.spec.ts` 10/10. `web/src/engines/` và `next.config.ts` không bị đụng.

Số đo thật trên Chrome (1440×900, bản build tại máy):
- Snapshot 3 tab Postgres, chạy tab thứ ba: **2.959 ms** từ lúc bấm tới khi có bảng kết quả (gồm tải WASM PGlite lần đầu), 3 câu đã chạy, nhãn `Thật`.
- Vùng kết quả: **1280×186 px**, `document.scrollWidth` 1280 = `innerWidth` 1280 → không tràn.
- Câu treo (`generate_series(1, 20000000)`): ngắt và hiện lỗi sau **4.501 ms** tính cả lần tải WASM đầu tiên; phần câu SQL bị cắt đúng hạn 1.500 ms.
- 390×844 bản tiếng Anh: `scrollWidth` 390 = `innerWidth` 390, bảng kết quả 366/366 px → không tràn ngang.
- AC4: ghi lại toàn bộ request trong lượt chạy — **0 request tới `/api/*`**, **0 request mang payload**, mọi request chỉ tới chính origin (WASM tĩnh của PGlite).

Chưa làm được / giới hạn:
- Safari/Firefox chưa kiểm (Playwright WebKit thiếu executable, như Task131/145/147).
- `setupSql` chạy lại toàn bộ SQL của các tab trước, kể cả khi tab đó là `BEGIN;`/`UPDATE` của một kịch bản tranh chấp: kết quả vẫn đúng nhưng không phải "mô phỏng 2 phiên" — vùng kết quả chỉ nói câu cuối trả gì.
- Tab có `BEGIN` mà không `COMMIT` vẫn chạy được nhưng transaction bị bỏ khi phiên bị dispose; không có cảnh báo riêng.
- Reviewer ghi `needs_validation`: E2E AC6 loại trừ khóa `sqllens.layout` (khóa bố cục có sẵn của shell) — chưa chứng minh được khóa đó không bao giờ chứa dữ liệu kết quả. Đã kiểm thêm: nội dung kho lưu trữ không chứa `bình`, `chi`, `accounts`, hay tên dự án.

Phát sinh (SP999):
1. Trang share chưa có ERD/Plan/B-Tree như prototype màn hình 2 (chỉ có editor + vùng kết quả). Nếu chủ dự án muốn bám prototype đầy đủ thì cần task riêng.
2. `MAX_SNAPSHOT_RESULT_ROWS = 2.000` là con số chọn theo cảm tính an toàn; nên đo lại trên máy RAM thấp nếu có phản hồi chậm.
3. Vẫn còn 4 lỗi E2E có sẵn trên `main` (Task113/114/128) đã ghi ở mục trước của `AGENTS.md`, chưa sửa.
4. `web/e2e/share-run-shots.spec.ts` ghi ảnh thẳng vào `_bmad-output/`, nên chạy cả bộ E2E sẽ làm bẩn worktree; nếu khó chịu thì chuyển sang `test-results/`.
5. `createLocalAdapter` (PGlite/SQLite) không nhận `AbortSignal`, nên mọi chỗ gọi khác cũng phải tự đua với tín hiệu hủy như Task148 vừa làm. Nên thêm `signal` vào chữ ký adapter ở một task riêng để khỏi lặp lại cái bẫy này.
6. Reviewer vòng 2 thấy `404 /_next/static/chunks/libpg-query.wasm` 3 lần rồi guard vẫn hoạt động (do `engines/postgres/guard.ts` vá `fetch` sang URL có hash và thử lại 3 lần) — hành vi có sẵn từ Task021, chỉ là tiếng ồn console.

Việc tiếp theo cần biết: Task148 là task cuối của STR101; xong là **đóng Epic SP022 (Share qua URL)**. Epic tiếp theo là **SP023 (Cloud sync & RLS, Task149-156)**. `runSnapshotTab` cố ý không đụng tới workspace/IndexedDB, nên SP023 có thể dùng lại nó cho bản xem cloud mà không sửa gì.
