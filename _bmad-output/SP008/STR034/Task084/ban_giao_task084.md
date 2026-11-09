# Bàn giao Task084

Đã làm: Xây dựng module `btree-builder.ts` dựng cây B+Tree InnoDB chuẩn xác từ cấu trúc bảng, dữ liệu mẫu và đối chiếu thống kê `mysql.innodb_index_stats`. Tích hợp vào MySQL adapter thay thế trạng thái `not_simulated` của tab B-Tree. Hoàn thiện trực quan hóa hoạt ảnh rơi key 2 lần (Bookmark Lookup) trên 2 cây đồng thời (Secondary Index -> Clustered Index) và phát hiện Covering Index chỉ rơi trên 1 cây kèm huy hiệu xanh. Hỗ trợ range scan trượt ngang giữa các leaf nodes qua liên kết doubly-linked list.
File chính:
- `web/src/engines/mysql/btree-builder.ts` & `web/src/engines/mysql/btree-builder.test.ts`
- `web/src/engines/mysql/adapter.ts`
- `web/src/modules/lab/stage/stage.tsx`, `stage-data.ts`, `stage-data.test.ts`
- `web/src/modules/btree-reader/anim/btree-drop.tsx`, `steps.ts`, `steps.test.ts`
- `web/src/modules/btree-reader/view/btree-view.tsx`
- `web/e2e/mysql-btree.spec.ts`
- `web/messages/{vi,en}/{btree,btree-anim,mysql}.json`
Kết quả kiểm tra:
- `npm run check` (check:i18n, lint, typecheck, vitest): thoát 0, 535 tests pass, 16 skipped, i18n đồng bộ 100%.
- `npx playwright test e2e/mysql-btree.spec.ts`: thoát 0, 6/6 tests pass (Desktop 1440px, Mobile 390px, song ngữ vi/en).
- `API_ORIGIN=http://localhost:8080 npm run build`: thoát 0.
Kết quả review: Đã sửa 2/2 lỗi confirmed qua 1 vòng sửa lỗi:
- Lỗi 1: `getMinKey` đệ quy theo con đầu tiên `children[0]` xuống leaf node để lấy chính xác separator key cho cây B+Tree >= 3 tầng, bổ sung unit test xác thực.
- Lỗi 2: Phân vùng `registry` tọa độ node theo `treeKey` thay vì singleton toàn cục, đảm bảo hoạt ảnh hiển thị đồng thời 2 cây không đè hay mất tọa độ node ở giai đoạn 1, bổ sung test assertions kiểm tra hiển thị và tọa độ.
Chưa làm được: Không có.
Phát sinh:
- Xóa mục `needs_validation` trong `SP999` về việc `nodePosition` bị đè khi mở nhiều `BTreeView` đồng thời do đã được giải quyết bằng `registryByTree` phân vùng theo `treeKey`.
Việc tiếp theo cần biết: Cây B-Tree của MySQL luôn mang nhãn `Mô phỏng` (`Simulated`) với tooltip minh bạch. `treeKey` phân vùng theo format `${model.engine}:${model.table}.${model.index}`. Cây Clustered Index có root bắt đầu từ page 3, còn Secondary Index bắt đầu từ page 10.
