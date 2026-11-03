# Task039: Đọc cây B-Tree thật của PostgreSQL

Thuộc: SP008 / STR033
Mục tiêu: Từ tên một index, đọc cây thật bằng `pageinspect` qua kênh quản trị và trả `BTreeModel`, kèm đường đi của một khóa. SQL người dùng không chạm được kênh này.
Phạm vi: `web/src/engines/postgres/btree*`, `web/src/engines/postgres/protocol.ts`, `web/src/engines/postgres/worker.ts`, `web/src/engines/postgres/adapter.ts`, `web/src/contracts/engine.ts`, `web/e2e/btree-read.spec.ts`.
Không làm: vẽ cây (Task040), animation, MySQL (STR034), sửa `web/src/contracts/btree.ts` (đã chốt, cần đổi thì báo phiên chính).

Hợp đồng:
- Kiểu `BTreeModel`, `BTreeNode`, `BTreePath` ở `web/src/contracts/btree.ts`.
- `EngineAdapter` thêm `readBTree(index: string, options?: { probeKey?: string; maxNodes?: number }): Promise<{ model: Outcome<BTreeModel>; path?: BTreePath }>`. `maxNodes` mặc định 200.
- Kết luận nhãn Thật. Index không phải B-Tree, không tồn tại, hay khóa có kiểu chưa đọc được: trả `NotSimulated` với lý do cụ thể, không đoán.
- Đi qua `adminQuery` của Task021. Thêm message mới vào `protocol.ts`, không mở đường nào cho SQL người dùng.
- Tên index do người dùng chọn phải được kiểm là index có thật trong schema `public` trước khi ghép vào câu quản trị, và luôn truyền dạng tham số hoặc `regclass`, không ghép chuỗi.

Tiêu chí xong:
- AC1: Bảng 100k dòng với index `int`: `height`, `rootPage`, `totalPages` khớp `bt_metap` và `pg_relation_size`. Các trang đã đọc có `keys` đúng thứ tự tăng dần.
- AC2: `probeKey` 54321: `path.pages` đi đúng từ root xuống leaf chứa khóa, và `heapPage` là trang heap thật của dòng đó (đối chiếu `ctid`).
- AC3: Cây lớn hơn `maxNodes`: chỉ đọc đường đi của `probeKey` cộng các trang lân cận, phần còn lại vào `hidden` đúng số lượng theo từng tầng. 500k dòng đọc xong dưới 1 giây trong Chromium. Ghi số đo.
- AC4: Khóa kiểu `int`, `bigint`, `text`, `uuid`, `timestamptz` hiện đúng dạng chữ. Index nhiều cột hiện đủ các cột. Kiểu khác chưa đọc được thì trả `NotSimulated`.
- AC5: Index `hash`, `gin` hoặc tên không tồn tại: `NotSimulated` với lý do riêng cho từng trường hợp. Tên index có ngoặc kép, chữ hoa hoặc chứa `'; DROP TABLE` không làm hỏng và không chạy được lệnh nào.
- AC6: Gọi `readBTree` không thêm gì vào `history()` và không đổi `current_user` của phiên người dùng. Lớp kiểm thứ hai của Task021 vẫn đạt sau khi gọi.
- AC7: Playwright trên bản `next build` cho AC1, AC2, AC3 qua adapter thật. `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: bảng rỗng (cây chỉ có root là leaf); index vừa bị xóa giữa lúc đọc; khóa trùng nhiều (deduplication của PostgreSQL 13 trở lên gộp nhiều tid vào một item).
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: bảo mật (kênh quản trị, tên index), nhãn kết luận.
Đọc thêm: `_bmad-output/SP002/STR007/Task013/ket_qua.md`; bàn giao Task019, Task021, Task025; `CLAUDE.md` nguyên tắc 1, 4, 8 và mục "Đã kiểm chứng" phần `pageinspect`.
