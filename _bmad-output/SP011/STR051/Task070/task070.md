# Task070: Timeline hai session và đồ thị chờ khóa

Thuộc: SP011 / STR051
Mục tiêu: Người dùng chọn một trong 5 kịch bản tranh chấp của PostgreSQL, xem hai session chạy theo từng nhịp, tua được, thấy đồ thị chờ khóa và kết quả hỏng hay không hỏng.
Phạm vi: `web/src/modules/conflict-sim/ui/**`, `web/src/app/[locale]/e2e-conflict/**`, `web/src/modules/lab/stage/stage.tsx` (chỉ thêm tab "Tranh chấp"), `web/messages/{vi,en}/conflictSim.json`, `web/e2e/conflict.spec.ts`.
Không làm: sửa mô hình `conflict-sim/engine/**` (lỗi rõ ràng thì sửa và ghi lại), tiêu chí hỏng do người dùng viết (STR052), MySQL (STR050).

Hợp đồng: `<ConflictPanel />` không cần adapter, vì giả lập chạy trong TypeScript. Dùng `simulate`, `SCENARIOS`, `withIsolation`, `doubleBooking` có sẵn. Đồ thị dùng Cytoscape.js, tải riêng bằng `dynamic`, theo `CLAUDE.md`. Điều khiển dùng shadcn/ui. Chuyển động theo cách "một số `p`" của Task045 nếu dùng GSAP, chỉ chạy khi người dùng bấm.

Tiêu chí xong:
- AC1: Đủ 5 kịch bản: lost update, deadlock do cập nhật ngược thứ tự, write skew, double booking, non-repeatable read. Không có dirty read. Chọn được mức cô lập và kiểu bảo vệ mà mô hình hỗ trợ.
- AC2: Hai cột session A và B theo từng nhịp, mỗi nhịp hiện câu SQL, trạng thái đang chạy, đang chờ, bị hủy, đã commit, kèm câu giải thích dễ hiểu cho người mới. Có Chạy, Tạm dừng, Bước tới, Bước lùi, Về đầu, thanh tua. Lùi trả đúng trạng thái.
- AC3: Có chờ khóa thì đồ thị hiện đúng cạnh chờ. Deadlock thì hiện vòng. Bên bị hủy theo kết quả mô hình, nhưng câu chữ không được khẳng định PostgreSQL thật luôn hủy bên đó.
- AC4: Mọi kết quả mang nhãn Mô phỏng, nêu đã đối chiếu với PostgreSQL thật trong CI (Task051). `not_broken` chỉ nói "không hỏng trong kịch bản này ở mức cô lập này", không hàm ý thiết kế ổn. `NotSimulated` hiện lý do. Không có thời gian chạy.
- AC5: Dịch đủ `conflictSim.tick.*`, `conflictSim.error.*`, `conflictSim.outcome.*`, `conflictSim.notSimulated.*`, test quét các câu `outcome`.
- AC6: Đổi kịch bản hoặc mức cô lập giữa lúc chạy thì dừng và dựng lại đúng, không chồng trạng thái cũ. Giá trị trong bảng ở mỗi nhịp hiện đúng theo `Timeline`, test đối chiếu với kết quả `simulate`, không chỉ kiểm có phần tử.
- AC7: `npm run check`, `npm run build` thoát 0. `web/e2e/conflict.spec.ts`, `web/e2e/lab-stage.spec.ts` đạt với `--workers=1`.

Giao diện: Có giảm chuyển động, có bàn phím, tóm tắt dạng văn bản cho đồ thị. Đủ tiếng Việt và tiếng Anh. Ở 390 px hai session xếp theo cách vẫn đọc được thứ tự nhịp, không cuộn ngang trang. Lưu ảnh chụp trong `_bmad-output/SP011/STR051/Task070/anh/`, chụp từng nhịp cho deadlock và lost update, 1440 và 390 px hai ngôn ngữ, tự mở xem, ghi rõ đã xem ảnh nào.
Ca biên: bấm Chạy liên tục, tua khi đang chạy, đổi tab rồi quay lại, đổi cỡ cửa sổ khi đồ thị đang hiện.
Góc review thêm: giao diện, nhãn kết luận, đúng hành vi PostgreSQL.
Đọc thêm: bàn giao Task050, Task051, Task045, Task062; `CLAUDE.md` các mục "Khác biệt giữa hai engine", "Nguyên tắc không được phá".
