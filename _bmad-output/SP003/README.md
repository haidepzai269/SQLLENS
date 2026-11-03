# SP003: Engine PostgreSQL

Kết quả: PostgreSQL chạy trong trình duyệt một cách an toàn và không làm treo giao diện. Người dùng dán SQL trên màn hình chính, sinh dữ liệu đến 500k dòng, xem kết quả, và thử một thay đổi rồi hoàn tác. Các Epic sau (`plan-runner`, `btree-reader`, `what-if`) gọi engine qua `EngineAdapter`.

Dựa trên số đo của SP002: Task012 (thời gian, RAM), Task013 (`pageinspect`, quyền), Task011 (nạp WASM).

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR012 Nạp PGlite | Task019 | PGlite chạy trong Web Worker, có tiến trình tải, timeout và hủy | Không | 1 |
| STR013 Chạy SQL an toàn | Task022 | Lưới kết quả và hiển thị lỗi | Không | 1 |
| STR014 `data-lab` | Task023 | Lõi sinh dữ liệu theo schema | Không | 1 |
| STR012 Nạp PGlite | Task020 | Đưa phòng thử vào màn hình chính, giao diện tải và lỗi | Task019, Task022 | 2 |
| STR013 Chạy SQL an toàn | Task021 | Role quyền thấp, chặn thoát role, kênh quản trị riêng | Task019 | 2 |
| STR014 `data-lab` | Task024 | Giao diện sinh dữ liệu | Task020, Task021, Task023 | 3 |
| STR015 Thử rồi hoàn tác | Task025 | Thử thay đổi trong transaction rồi rollback | Task021 | 3 |

## Các file bị đụng theo đợt

| Đợt | Task | File |
|---|---|---|
| 1 | Task019 | `web/src/engines/postgres/**`, `web/src/contracts/engine.ts` |
| 1 | Task022 | `web/src/components/result-grid/**`, `web/messages/*/result.json` |
| 1 | Task023 | `web/src/modules/data-lab/generate/**` |
| 2 | Task020 | `web/src/app/[locale]/page.tsx`, `web/src/app/[locale]/lab/**`, `web/src/modules/lab/**`, `web/messages/*/lab.json`, `web/e2e/lab.spec.ts` |
| 2 | Task021 | `web/src/engines/postgres/guard*`, `web/src/engines/postgres/roles*`, `web/src/engines/postgres/worker.ts`, `web/messages/*/guard.json` |
| 3 | Task024 | `web/src/modules/data-lab/ui/**`, `web/src/modules/lab/**` (chỉ thêm chỗ gắn nút), `web/messages/*/data-lab.json`, `web/e2e/data-lab.spec.ts` |
| 3 | Task025 | `web/src/engines/postgres/try-rollback*`, `web/src/contracts/engine.ts` |

Task024 và Task025 cùng đợt nhưng không chung file. Task020 và Task021 cùng đợt: Task021 sửa `worker.ts`, Task020 không được sửa file đó.

## Lưu ý chung

- PGlite chỉ có một kết nối. Hủy một câu đang chạy chỉ làm được bằng cách dừng worker, và khi đó dữ liệu trong bộ nhớ mất. Engine phải giữ lại danh sách câu đã chạy thành công để dựng lại khi người dùng muốn.
- Giới hạn số dòng theo `CLAUDE.md`: mặc định 100k, 500k có cảnh báo, trên 500k không chạy thật.
- Đỉnh RAM khoảng 1,1 GB xảy ra lúc khởi tạo PGlite, không phụ thuộc số dòng (Task012).

Trạng thái: xong ngày 2026-11-03, Task019 đến Task025 đã merge.
