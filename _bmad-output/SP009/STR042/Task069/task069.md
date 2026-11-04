# Task069: Màn hình rủi ro

Thuộc: SP009 / STR042
Mục tiêu: Cột Rủi ro hiện danh sách rủi ro thật sau khi chạy SQL, bấm một mục thì tô đúng chỗ trong SQL và sơ đồ, đồng thời AI nhận được danh sách này.
Phạm vi: `web/src/modules/findings/ui/**`, `web/src/modules/findings/evidence/**` (cho AC2), `web/src/modules/lab/lab-workspace.tsx` (chỉ `findingsZone` và chỗ truyền dữ liệu), `web/src/modules/lab/stage/**` (chỗ truyền findings cho Mentor và tô sơ đồ), `web/src/components/sql-editor/**` (nếu cần tô vùng), `web/messages/{vi,en}/findingsUi.json`, `web/e2e/findings.spec.ts`.
Không làm: thêm luật mới, MySQL thật, đổi nhãn của Task068.

Hợp đồng: Dùng `checkSchema`, `checkQueries`, `attachEvidence`, `adapter.explain`. Component shadcn/ui.

Tiêu chí xong:
- AC1: Sau khi chạy SQL, cột Rủi ro liệt kê từng rủi ro. Màu mức độ đỏ, vàng, xanh ở border và nền nhẹ, tách khỏi nhãn Thật, Mô phỏng, Ước lượng. Mỗi mục có câu mô tả, nhãn, và bằng chứng số dòng, số trang nếu có. `NotSimulated` hiện là "chưa mô phỏng được" kèm lý do. Kết luận chạy SQL hiện có vẫn giữ.
- AC2: Siết `not_broken` trong `attachEvidence`: chỉ xanh khi nút quét dùng index có liên quan đến cột trong luật, xét theo `node.index` và `node.condition`. Ví dụ `email LIKE '%77' AND id = 5` đọc qua index PK thì không được xanh, phải là `unverified` kèm câu nói rõ quan sát được gì. Có test tích hợp với ví dụ này.
- AC3: Danh sách rỗng hiện câu chỉ nói "Không có luật nào khớp trong các câu đã chạy", kèm phạm vi các luật đã kiểm. Không có câu nào hàm ý thiết kế ổn, và màu xanh không kèm chữ như "tốt", "an toàn". Test quét chữ trên màn hình.
- AC4: Bấm một mục: tô đúng vùng trong SQL khi có `start`, `end`, cuộn tới đó. Có `table` thì chuyển sang tab Sơ đồ và làm nổi thẻ bảng đó. Có `planNodeId` thì có nút mở đúng nút trong tab Plan. Bấm mục khác thì bỏ tô cũ. Sửa SQL sau khi chạy thì không tô lệch: báo kết quả thuộc lần chạy trước.
- AC5: Gói bằng chứng gửi Mentor có `findings`. Test bằng route giả: thân yêu cầu có `findings`, vẫn không chứa dòng dữ liệu.
- AC6: Chạy lại SQL thì danh sách thay mới, câu trả về muộn không ghi đè. Chạy luật và `explain` không vào `history()`, không làm chạy lại câu `SELECT` quá một lần cho mỗi lần chạy, dùng chung kết quả với tab Plan nếu có thể.
- AC7: `npm run check`, `npm run build` thoát 0. `web/e2e/findings.spec.ts`, `web/e2e/lab.spec.ts`, `web/e2e/lab-stage.spec.ts` đạt với `--workers=1`.

Giao diện: Trạng thái đang kiểm, rỗng, lỗi. Đủ tiếng Việt và tiếng Anh. Mục bấm được bằng bàn phím. Màu không phải tín hiệu duy nhất, có thêm chữ hoặc icon. Ở 390 px theo tab hiện có, bấm một mục thì chuyển sang tab tương ứng rõ ràng. Tự mở ảnh 1440 và 390 px cả hai ngôn ngữ, có đủ ba màu, ghi rõ đã xem ảnh nào.
Ca biên: 50 rủi ro, SQL lỗi giữa chừng, parser chưa tải, schema không có câu `SELECT`, khách chưa đăng nhập.
Góc review thêm: nhãn kết luận, nguyên tắc 1, 2, 3, 4, giao diện.
Đọc thêm: bàn giao Task052, Task053, Task062, Task063, Task068; dòng "Màu mức độ ở cột rủi ro" trong `CLAUDE.md`.
