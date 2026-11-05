# Task072: Range scan và khác biệt engine trên cây B-Tree

Thuộc: SP008 / STR037
Mục tiêu: Người dùng thấy range scan trượt ngang qua các leaf, và thấy PostgreSQL nhảy từ index sang heap.
Phạm vi: `web/src/modules/btree-reader/anim/**`, `web/src/modules/btree-reader/view/**` (chỉ khi cần), `web/src/modules/lab/stage/stage.tsx` (chỉ phần tab B-Tree), `web/messages/{vi,en}/btree-anim.json` hoặc namespace đang dùng, `web/e2e/btree-range.spec.ts`, `web/src/app/[locale]/e2e-btree-anim/**`.
Không làm: dựng cây MySQL thật (STR034), cuộc đua và cây tối (STR038), đọc cây bằng cách khác `readBTree`.

Hợp đồng: Dùng lại cách của Task045: một timeline chỉ tween `p`, thêm bước vào `buildSteps`, thêm phần tử vào lớp vẽ, tính từ `p`. `leaf.next` trong `BTreeNode` cho biết leaf bên phải. Chỉ dùng trang đã đọc thật. Trang chưa đọc thì không vẽ như đã đọc.

Tiêu chí xong:
- AC1: Tab B-Tree có chế độ khoảng khóa từ, đến. Key rơi tới leaf đầu theo đường đi thật, rồi trượt ngang qua các leaf bằng `next`, đếm số leaf đã đọc, dừng khi vượt khóa cuối. Bước tới, bước lùi, tua đều đúng. Khung tự cuộn theo vị trí đang đọc.
- AC2: `readBTree` chỉ đọc một phần cây nên có thể thiếu leaf ở giữa: animation dừng đúng chỗ dữ liệu có thật, hiện câu nói phần còn lại chưa đọc. Không vẽ leaf giả, không đoán số trang.
- AC3: PostgreSQL: bước cuối nhảy từ leaf sang heap với `heapPage` thật khi có, kèm câu giải thích. Không có `heapPage` thì bỏ bước này và không vẽ giả.
- AC4: Chế độ MySQL với secondary index rơi hai lần chỉ hiện khi có dữ liệu thật từ STR034. Hiện tại trên MySQL hiện `NotSimulated` đúng lý do, không vẽ minh họa như thật.
- AC5: Có nhãn đúng theo nguồn của cây, câu giải thích từng bước đủ hai ngôn ngữ, dành cho người mới. Không có thời gian chạy.
- AC6: Index cột đầu `DESC`, khoảng rỗng, từ lớn hơn đến, khóa sai kiểu: báo rõ, không vỡ.
- AC7: `npm run check`, `npm run build` thoát 0. `web/e2e/btree-range.spec.ts`, `web/e2e/btree-anim.spec.ts`, `web/e2e/lab-stage.spec.ts` đạt với `--workers=1`. Test đọc số leaf và các trang đã đi rồi đối chiếu với `readBTree` thật.

Giao diện: Animation chỉ chạy khi bấm. Có giảm chuyển động, có bàn phím. 1440 và 390 px, hai ngôn ngữ. Lưu ảnh chụp từng bước trong `_bmad-output/SP008/STR037/Task072/anh/`, tự mở xem, ghi rõ đã xem ảnh nào.
Ca biên: range qua nhiều leaf trên cây 3 tầng, kéo node khi đang chạy ở chế độ Kéo tự do, đổi index giữa lúc chạy.
Góc review thêm: giao diện, nhãn kết luận, đúng hành vi B-Tree.
Đọc thêm: bàn giao Task039, Task040, Task045, Task063.
