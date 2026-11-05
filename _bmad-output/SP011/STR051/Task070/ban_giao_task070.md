# Bàn giao Task070

Đã làm: Panel `ConflictPanel` cho 5 kịch bản tranh chấp của PostgreSQL. Chọn kịch bản, mức cô lập và kiểu bảo vệ của double booking. Hai session A và B chạy theo nhịp, mỗi nhịp có câu SQL, trạng thái, câu giải thích. Có Chạy, Tạm dừng, Bước tới, Bước lùi, Về đầu và thanh tua. Bảng dữ liệu đã commit và bảng mỗi session thấy đổi theo nhịp. Đồ thị chờ khóa bằng Cytoscape tải riêng, kèm tóm tắt văn bản. Kết quả mang nhãn Mô phỏng, nêu đã đối chiếu PostgreSQL thật trong CI, không có thời gian chạy. `NotSimulated` hiện lý do. Thêm đúng một tab "Tranh chấp" vào `stage.tsx`.
File chính: `web/src/modules/conflict-sim/ui/` (`conflict-panel.tsx`, `wait-graph.tsx`, `model.ts`, `model.test.ts`), `web/messages/{vi,en}/conflictSim.json`, `web/src/app/[locale]/e2e-conflict/`, `web/e2e/conflict.spec.ts`, `web/src/modules/lab/stage/stage.tsx`.
Kết quả kiểm tra:
- `npm run check`: lint 0 lỗi (1 cảnh báo cũ ở `plan-explain.spec.ts`), typecheck sạch, vitest 460 đạt, 16 bỏ qua. `check:i18n` sạch sau lần sửa cuối.
- `API_ORIGIN=http://localhost:8080 npm run build`: thoát 0.
- `E2E_PORT=3170 npx playwright test e2e/conflict.spec.ts --workers=1`: 30 đạt (chạy lại sau lần sửa cuối).
- `E2E_PORT=3170 npx playwright test e2e/lab-stage.spec.ts --workers=1`: 40 đạt. Lần chạy đầu 2 test 390 px trượt vì 7 tab tràn khung, đã sửa bằng `flex-wrap` và cho test kiểm 7 tab.
- Ảnh: `_bmad-output/SP011/STR051/Task070/anh/` (89 ảnh, từng nhịp deadlock và lost update, 1440 và 390, vi và en, not-simulated, stage-tab). Tôi đã tự xem `vi-1440-deadlock-06`, `en-390-lost-09`. Reviewer xem thêm 6 ảnh. Ảnh chụp sau lần sửa cuối chưa xem lại từng tấm.
Kết quả review: 0 lỗi chặn. Đã sửa 2 lỗi nhỏ: câu chờ khóa lặp "row row:", và nút điều khiển rơi lẻ ở 390 px (xếp lưới 3 cột). Test giá trị bảng ở mỗi nhịp nằm ở e2e (đối chiếu `simulate`), reviewer không chạy e2e, nhưng tôi đã chạy.
Chưa làm được: Chế độ giảm chuyển động chỉ kiểm bằng bàn phím, không có animation nào để giảm (không dùng GSAP, chạy bằng bộ đếm 1 giây mỗi nhịp). Màu đồ thị Cytoscape lấy một lần lúc dựng, đổi giao diện sáng tối giữa chừng không cập nhật.
Phát sinh:
- Route `/e2e-conflict` phải chặn ở SP013 như các route e2e khác.
- Khóa nội bộ như `row:accounts:2` hiện nguyên văn, có thể đổi thành chữ thân thiện hơn.
- Tab Tranh chấp chỉ hiện sau khi người dùng chạy một lần ở lab, dù nó không cần dữ liệu. Task066 và Task069 đang sửa `stage.tsx`, nên chưa đổi.
- `lab-stage.spec.ts` ghi đè ảnh Task062 mỗi lần chạy, đã `git checkout` lại, không commit.
Việc tiếp theo cần biết: `Stage` giờ có 7 tab, thanh tab xuống dòng ở màn hẹp. Bên bị hủy trong deadlock theo mô hình, câu chữ không khẳng định PostgreSQL thật hủy bên đó.
