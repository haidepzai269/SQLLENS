# Task063: Gắn Capacity và Mentor vào `stage`, cây B-Tree mở đúng chỗ

Thuộc: SP999 / STR062
Mục tiêu: Người dùng dùng được Capacity Advisor và AI Mentor ngay trên `/lab`, và cây B-Tree luôn cho thấy leaf chứa khóa đang xem.
Phạm vi: `web/src/modules/lab/stage/**`, `web/src/modules/lab/lab-workspace.tsx` (chỉ chỗ truyền dữ liệu), `web/src/modules/btree-reader/view/**`, `web/src/modules/btree-reader/anim/**` (nếu cần cho AC4), `web/messages/{vi,en}/labStage.json`, `web/e2e/lab-stage.spec.ts`.
Không làm: danh sách rủi ro (STR042), sửa logic bên trong `MentorPanel`, `CapacityPanel`, gọi model thật.

Hợp đồng: Thêm hai tab vào vùng `stage`, tải riêng theo tab như bốn tab hiện có, dùng `CapacityPanel` và `MentorPanel`. Gói bằng chứng dựng bằng `buildEvidencePack` từ câu `SELECT` đang xem, plan và kết quả `checkSchema`, `checkQueries` nếu có sẵn dữ liệu đầu vào. Chọn một nguồn cho `sqlRef` theo ghi chú trong bàn giao Task061 và ghi rõ đã chọn gì.

Tiêu chí xong:
- AC1: Tab Capacity: chọn index thật, câu thăm dò là `SELECT` đang xem nếu có. Không có index thì giải thích. Số trên màn hình khớp `measureCapacity` gọi trực tiếp. Dữ liệu người dùng và `history()` không đổi sau khi đo, kiểm bằng checksum.
- AC2: Tab Mentor khi chưa đăng nhập: có lời mời đăng nhập. Sau khi quay lại không mất SQL trong ô soạn và câu hỏi đang gõ.
- AC3: Tab Mentor khi đã đăng nhập (mock `/api/me`, route giả `/api/ai/chat`): thân yêu cầu gửi đi chứa SQL và plan của câu đang xem, không chứa dòng dữ liệu kết quả. Test đặt một chuỗi đánh dấu trong dữ liệu bảng và khẳng định chuỗi đó không có trong thân yêu cầu. Bấm Áp dụng thì chuyển sang tab Thử sửa hoặc mở so sánh tại chỗ, không commit gì.
- AC4: Tab B-Tree, cây 2 tầng và 3 tầng thật, nhập khóa nhỏ nhất và lớn nhất: ngay khi vẽ và ở mỗi bước, các trang trên đường đi `path.pages` nằm trong khung, kể cả leaf đích. Test lấy `path.pages` thật rồi đo tọa độ node so với khung. Hiện ảnh `_bmad-output/SP999/STR062/Task062/anh/1440-vi-btree.png` với khóa 5 chỉ thấy các leaf 622 trở đi: đây là lỗi đã thấy, phải tái hiện trước khi sửa.
- AC5: `CapacityPanel` cây 3 tầng: tầng internal thấy được trong khung, xem `_bmad-output/SP010/STR047/Task057/vi-1440-real.png`, ảnh đó chỉ thấy root và leaf. Tái hiện rồi sửa nếu đúng. Nếu không tái hiện được thì ghi rõ cách đã thử.
- AC6: Chạy lại SQL: tab Capacity, Mentor không hiện số hoặc câu trả lời cũ như của lần chạy mới. Đổi tab không chạy lại việc đã làm.
- AC7: `npm run check`, `npm run build` thoát 0. `web/e2e/lab-stage.spec.ts`, `web/e2e/capacity.spec.ts`, `web/e2e/mentor.spec.ts`, `web/e2e/btree-view.spec.ts` đạt với `--workers=1`.

Giao diện: Sáu tab vừa khung ở 1440 và 390 px, không cuộn ngang trang. Đủ tiếng Việt và tiếng Anh. Bàn phím đổi được tab. Tự mở ảnh chụp bản cuối: mỗi tab mới một ảnh ở 1440 và một ở 390, cả hai ngôn ngữ, cộng ảnh AC4, AC5, ghi rõ đã xem ảnh nào.
Ca biên: chưa chạy gì, không có `SELECT`, engine MySQL, hủy lúc đang đo, đang stream thì chạy lại SQL.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3163 npx playwright test e2e/lab-stage.spec.ts e2e/capacity.spec.ts e2e/mentor.spec.ts e2e/btree-view.spec.ts --workers=1`.
Góc review thêm: bảo mật (dữ liệu nào đi lên AI), giao diện, nhãn kết luận.
Đọc thêm: bàn giao Task057, Task061, Task062; `CLAUDE.md` nguyên tắc 6, 7.
