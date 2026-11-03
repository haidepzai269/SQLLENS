# Task049: Animation join

Thuộc: SP007 / STR032
Mục tiêu: Người mới thấy Nested Loop, Hash Join, Merge Join chạy thế nào, theo đúng loại join và số dòng của plan thật, và biết đây là mẫu minh họa.
Phạm vi: `web/src/modules/plan-runner/join-anim/**`, `web/src/app/[locale]/e2e-join/**`, `web/messages/*/join-anim.json`, `web/e2e/join-anim.spec.ts`.
Không làm: gắn vào màn hình chính, gọi engine, sửa `web/src/contracts/plan.ts`.

Hợp đồng:
- `JoinAnimation({ node, engine }: { node: PlanNode; engine: EngineId })`, `node.kind` là một trong ba loại join.
- GSAP, một timeline tua được hai chiều. Theo bàn giao Task045 nếu đã có.
- Nhãn Mô phỏng. Luôn ghi rõ là mẫu minh họa, chạy trên một mẫu nhỏ, kèm số dòng thật của plan.

Tiêu chí xong:
- AC1: Nested Loop: mỗi dòng bảng ngoài đi dò bảng trong. Hash Join: dựng bảng băm từ một bảng rồi dò từ bảng còn lại. Merge Join: hai con trỏ trượt song song trên dữ liệu đã sắp xếp.
- AC2: Merge Join với `engine: "mysql"` không chạy, trả "chưa mô phỏng được" kèm lý do MySQL không có Merge Join. Node không phải join cũng vậy.
- AC3: Chỉ chạy khi bấm Chạy. Có Chạy, Tạm dừng, Bước tới, Bước lùi, Về đầu. Tua trả đúng trạng thái.
- AC4: Câu giải thích từng bước, và dòng ghi rõ "mẫu minh họa, plan thật có N dòng" với N lấy từ `node`. Không hiện thời gian, so sánh bằng số dòng đã dò.
- AC5: `prefers-reduced-motion` không có chuyển động, vẫn đi từng bước được. Có tóm tắt văn bản. Dùng được bằng bàn phím.
- AC6: Ở 390 px không cuộn ngang. Đủ `vi` và `en`. Chụp ảnh từng bước ở 390 px và 1440 px, xem tận mắt.
- AC7: `npm run check`, `npm run build`, `npx playwright test --workers=1` đều đạt.

Ca biên: số dòng thật là 0 hoặc `undefined`; rời trang giữa lúc chạy thì dọn timeline.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test --workers=1`
Góc review thêm: giao diện, chạy thử thật, nhãn kết luận.
Đọc thêm: `CLAUDE.md` mục "Giao diện join", nguyên tắc 1, 3, 4; `DESIGN.md` phần GSAP; bàn giao Task045.
