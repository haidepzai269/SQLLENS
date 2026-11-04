# Task062: Gắn các module vào vùng `stage` của màn hình chính

Thuộc: SP999 / STR062
Mục tiêu: Sau khi bấm Chạy trên `/lab`, người dùng thấy sơ đồ bảng, cây plan, animation join, cây B-Tree và phần thử sửa ngay trong vùng `stage`, thay cho placeholder hiện tại.
Phạm vi: `web/src/modules/lab/stage/**`, `web/src/modules/lab/lab-workspace.tsx` (chỉ chỗ gắn `stageZone` và chỗ truyền dữ liệu), `web/messages/{vi,en}/labStage.json`, `web/e2e/lab-stage.spec.ts`.
Không làm: Capacity và Mentor (Task057, Task061 chưa merge, gắn ở task sau), danh sách rủi ro (STR042), MySQL, sửa logic bên trong các module. Lỗi của module được phát hiện thì sửa nếu nhỏ và ghi lại, lớn thì ghi vào bàn giao.

Hợp đồng: Vùng `stage` là các tab shadcn/ui, tải riêng theo tab. Dùng nguyên `SchemaDiagram`, `PlanTree`, `JoinAnimation`, `BTreeDrop`, `WhatIfCompare`, `adapter.explain`, `adapter.readBTree`.

Tiêu chí xong:
- AC1: Chưa chạy gì: vùng `stage` vẫn có gợi ý. PostgreSQL chưa tải thì mở trang không tải WASM, giữ đúng hành vi hiện tại.
- AC2: Chạy SQL có `CREATE TABLE` với khóa ngoại: tab Sơ đồ hiện đúng bảng, cột, PK, FK đọc từ database thật, không từ chuỗi SQL.
- AC3: Chạy một `SELECT`: tab Plan hiện `PlanTree` từ `adapter.explain`, nhãn Thật. Nhiều câu thì lấy câu `SELECT` cuối và ghi rõ đang xem câu nào. `NotSimulated` hiện lý do.
- AC4: Plan có `nested_loop`, `hash_join` hoặc `merge_join`: có `JoinAnimation` cho nút join, ghi rõ là mẫu minh họa, chỉ chạy khi người dùng bấm. Plan không có join thì không hiện khu này.
- AC5: Tab B-Tree: chọn index trong danh sách index thật của schema, nhập khóa, thấy `BTreeDrop` với cây thật, nhãn Thật. Không có index thì giải thích và không vẽ cây giả.
- AC6: Tab Thử sửa: `WhatIfCompare` với câu `SELECT` đang xem làm câu thăm dò. Chưa có `SELECT` thì giải thích.
- AC7: Chạy lại SQL: mọi tab cập nhật theo lần chạy mới, câu trả về muộn không ghi đè. Đọc dữ liệu cho tab không vào `history()`, không đổi dữ liệu người dùng, kiểm bằng checksum. Bị hủy hay engine dựng lại thì tab không hiện số cũ như số mới.
- AC8: Kiểm lại ba điểm phiên chính thấy trên ảnh Task047 ở `SP999`: 120 bảng khi hiện đủ cột thì "Vừa màn hình" đưa toàn bộ cây vào khung (test đo bằng tọa độ node so với khung), cây thật của 3 bảng ở 390 px không có đường nối cắt qua chữ, và 120 bảng có cách tìm được bảng. Sửa được gọn thì sửa, không thì ghi rõ vào bàn giao.
- AC9: `npm run check`, `npm run build` thoát 0. `web/e2e/lab-stage.spec.ts`, `web/e2e/lab.spec.ts`, `web/e2e/auth.spec.ts` đạt với `--workers=1`.

Giao diện: Trạng thái đang tải, rỗng, lỗi cho từng tab. Đủ tiếng Việt và tiếng Anh. Tab đổi được bằng bàn phím. Điện thoại vẫn theo tab của khung hiện có, không cuộn ngang trang. Animation chỉ chạy khi bấm. Tự mở ảnh chụp 1440 và 390 px ở cả hai ngôn ngữ, mỗi tab ít nhất một ảnh ở 1440 và một ảnh ở 390, ghi rõ đã xem ảnh nào.
Ca biên: SQL không tạo bảng nào, schema 120 bảng, đổi sang MySQL rồi quay lại, tab đang mở khi chạy lại, transaction của người dùng đang mở nên `explain` trả `NotSimulated`, index kiểu chưa đọc được.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3162 npx playwright test e2e/lab-stage.spec.ts e2e/lab.spec.ts e2e/auth.spec.ts --workers=1`.
Góc review thêm: giao diện, nhãn kết luận, câu đọc catalog có chạy đúng đường quản trị hay role quyền thấp và không đưa SQL người dùng vào câu đó.
Đọc thêm: bàn giao Task045, Task047, Task048, Task049, Task056, Task044; `CLAUDE.md` các dòng "Bố cục màn hình chính", "Animation trong sản phẩm".
