# Task045: Key rơi từ root xuống leaf

Thuộc: SP008 / STR036
Mục tiêu: Trên cây của Task040, key rơi từ root qua internal xuống leaf theo đường đi thật, chạy từng bước, tua lại được, kèm câu giải thích từng bước cho người mới.
Phạm vi: `web/src/modules/btree-reader/anim/**`, `web/src/app/[locale]/e2e-btree-anim/**`, `web/messages/*/btree-anim.json`, `web/e2e/btree-anim.spec.ts`.
Không làm: sửa `btree-reader/view/**` (cần đổi thì báo phiên chính), gắn vào màn hình chính (task sau), range scan và khác biệt engine (STR037), cuộc đua (STR038).

Hợp đồng:
- `BTreeDrop({ model, path, label }: { model: BTreeModel; path: BTreePath; label: EvidenceLabel })`: dùng `BTreeView` của Task040 và lấy vị trí bằng `nodePosition`, vẽ thêm lớp key lên trên.
- GSAP, một timeline duy nhất tua được hai chiều, theo `DESIGN.md`. Câu giải thích, nhật ký bước và bộ đếm trang đều suy ra từ vị trí timeline, không giữ trạng thái riêng. Nếu GSAP không hợp với cây này thì phải báo trong bàn giao, theo `QUY_TRINH.md` mục 8.
- Không có `path` thì không chạy animation và nói rõ lý do, không vẽ đường đi đoán.

Tiêu chí xong:
- AC1: Trạng thái đầu là tĩnh, cây đủ nét, chưa có key rơi. Mở màn hình, đổi kiểu di chuyển, kéo node đều không tự chạy. Chỉ chạy khi bấm nút Chạy của cảnh.
- AC2: Chạy hết: key đi qua đúng từng trang trong `path.pages`, theo thứ tự, trang đi qua sáng màu đèn. Với PostgreSQL có `heapPage` thì bước cuối nhảy sang heap.
- AC3: Có Chạy, Tạm dừng, Bước tới, Bước lùi, Về đầu. Bước lùi và tua trả cây, câu giải thích, bộ đếm trang về đúng trạng thái tại bước đó, kiểm bằng ảnh chụp từng bước.
- AC4: Mỗi bước có một câu giải thích dùng số thật, ví dụ khóa đang so và trang đang đọc. Bộ đếm trang đọc khớp số trang đã đi qua. Không có câu nào hàm ý "thiết kế ổn". Không hiện thời gian chạy.
- AC5: Ở "Kéo tự do", kéo node trong lúc chạy: key không bay về vị trí cũ, cảnh chạy tiếp đúng thời điểm, theo `EXPERIENCE.md` mục 7.
- AC6: `prefers-reduced-motion`: không có chuyển động, vẫn đi được từng bước bằng nút. Có bản tóm tắt văn bản của đường đi cho trình đọc màn hình. Nút dùng được bằng bàn phím.
- AC7: Ở 390 px: không cuộn ngang, câu giải thích dính ở đáy vùng, không khuất, theo `EXPERIENCE.md`. Đủ `vi` và `en`, không chuỗi cứng. Chụp ảnh từng bước ở 390 px và 1440 px, lưu vào thư mục task.
- AC8: `npm run check`, `npm run build`, `npx playwright test --workers=1` đều đạt.

Ca biên: `path` trỏ trang đang nằm trong khối `hidden` thì key đi vào khối đó; cây một tầng; rời trang giữa lúc chạy thì timeline được dọn, không rò rỉ.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test --workers=1`
Góc review thêm: giao diện, chạy thử thật, nhãn kết luận.
Đọc thêm: bàn giao Task039, Task040; `DESIGN.md` phần GSAP; `EXPERIENCE.md` mục 6 và 7; `CLAUDE.md` nguyên tắc 5 và mục "Giao diện B-Tree"; skill `gsap-skills:gsap-timeline`, `gsap-skills:gsap-react`.
