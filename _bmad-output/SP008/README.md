# SP008: `btree-reader`

Kết quả: Người dùng thấy cây B-Tree thật của index, thấy key rơi từ root xuống leaf, range scan trượt ngang, và khác biệt giữa hai engine.

Hợp đồng chung: `web/src/contracts/btree.ts` (`BTreeModel`, `BTreeNode`, `BTreePath`), chốt trước khi chia task để Task039 và Task040 chạy song song.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR033 Đọc cây PostgreSQL | Task039 | `readBTree` qua kênh quản trị, đường đi của một khóa | Không | 1 |
| STR035 Vẽ cây | Task040 | Component SVG, gom node, hai kiểu di chuyển | Không | 1 |
| STR036 Key rơi | chưa chia | Key rơi từng bước, tua lại, câu giải thích, gắn vào vùng `stage` | Task039, Task040, Task027 | 2 |
| STR037 Range scan và khác biệt engine | chưa chia | | STR036 | 3 |
| STR038 Cuộc đua và cây tối | chưa chia | | STR036, SP007 STR029 | 3 |
| STR034 Dựng cây MySQL | chưa chia | | SP004 STR019 | sau |

## Các file bị đụng

| Task | File |
|---|---|
| Task039 | `web/src/engines/postgres/btree*`, `protocol.ts`, `worker.ts`, `adapter.ts`, `web/src/contracts/engine.ts`, `web/e2e/btree-read.spec.ts` |
| Task040 | `web/src/modules/btree-reader/view/**`, `web/src/app/[locale]/e2e-btree/**`, `web/messages/*/btree.json`, `web/e2e/btree-view.spec.ts` |

Task027 cũng sửa `web/src/engines/postgres/**` và `web/src/contracts/engine.ts`, nên Task027 chạy sau Task039.
