# SP010: `what-if`

Kết quả: Người dùng sửa thiết kế rồi thấy ngay số dòng và số trang trước và sau, không đổi dữ liệu. Kéo thanh quy mô thì thấy số tầng, dung lượng index và số trang đọc, nhãn đổi từ Thật sang Ước lượng đúng lúc vượt 500k.

Hợp đồng chung: `web/src/contracts/whatif.ts` (`WhatIfData`, `CapacitySample`, `CapacityPoint`), chốt trước khi chia task để Task054 và Task055 chạy song song.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR043 Thử sửa PostgreSQL | Task054 | `compareFix` chuẩn hóa kết quả `tryChange` thành `WhatIfData` | Task025, Task046 | 1 |
| STR046 Số liệu Capacity | Task055 | Đo từ cây thật và công thức ngoại suy, đối chiếu Postgres thật | Task039 | 1 |
| STR045 Màn hình so sánh | Task056 | Chia đôi trước và sau, sửa rồi chạy lại | Task054 | 2 |
| STR047 Màn hình Capacity | Task057 | Thanh quy mô, cây mọc tầng, nhãn đổi khi vượt 500k | Task055 | 2 |
| STR044 Thử sửa MySQL | chưa chia | Bảng clone, cần adapter MySQL | SP004 STR019 | sau |

## Các file bị đụng

| Task | File |
|---|---|
| Task054 | `web/src/modules/what-if/compare/**`, `web/messages/*/whatIfCompare.json` |
| Task055 | `web/src/modules/what-if/capacity/**`, `web/messages/*/capacity.json` |
| Task056 | `web/src/modules/what-if/compare-ui/**`, `web/src/app/[locale]/e2e-whatif/**`, `web/messages/*/whatIfUi.json`, `web/e2e/whatif.spec.ts` |
| Task057 | `web/src/modules/what-if/capacity-ui/**`, `web/src/app/[locale]/e2e-capacity/**`, `web/messages/*/capacityUi.json`, `web/e2e/capacity.spec.ts` |

Trạng thái: Task054 đến Task057 đã merge ngày 2026-11-04. Còn STR044 chờ adapter MySQL. Gắn Capacity vào vùng `stage` là việc riêng.
