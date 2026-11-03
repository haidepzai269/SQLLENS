# Task040: Vẽ cây B-Tree

Thuộc: SP008 / STR035
Mục tiêu: Component vẽ một `BTreeModel` thành cây trên nền tối kiểu phòng lab, đọc được với cây lớn, có hai kiểu di chuyển "Cố định" và "Kéo tự do", không chồng chữ.
Phạm vi: `web/src/modules/btree-reader/view/**`, `web/src/app/[locale]/e2e-btree/**`, `web/messages/*/btree.json`, `web/e2e/btree-view.spec.ts`.
Không làm: đọc cây (Task039), key rơi và animation (Task041), gắn vào màn hình chính, sửa `web/src/contracts/btree.ts`.

Hợp đồng:
- `BTreeView({ model, path, label, mode, onModeChange }: { model: BTreeModel; path?: BTreePath; label: EvidenceLabel; mode: "fixed" | "free"; onModeChange: (m: "fixed" | "free") => void })`.
- Tự vẽ bằng SVG theo `CLAUDE.md` và `DESIGN.md`. Không dùng Cytoscape.js hay React Flow cho cây này. Không thêm thư viện.
- Mỗi node có thuộc tính `data-page` để Task041 tìm vị trí khi chạy animation. Hàm `nodePosition(page: number): { x: number; y: number } | undefined` xuất ra cho Task041.
- Lưu kiểu di chuyển ở `sqllens.btree.mode` và độ lệch node ở `sqllens.btree.pg`, theo `EXPERIENCE.md`, đọc ghi trong `try/catch`.

Tiêu chí xong:
- AC1: Cây 3 tầng từ fixture: root, internal, leaf đúng tầng, cạnh nối đúng trang con, leaf nối ngang theo `next`. Có `path` thì các trang trên đường đi được tô bằng màu đèn, nhánh khác giữ màu `control`, theo `DESIGN.md`.
- AC2: `hidden` hiện thành một khối dạng `+206 node` ở đúng tầng, kèm câu dịch đủ `vi` và `en`. Cây 500k dòng từ fixture (khoảng 200 node đã đọc) vẽ dưới 100 ms, không có khung nào chờ quá 200 ms. Ghi số đo.
- AC3: Node có nhiều khóa chỉ hiện một phần, có `title` cho chữ bị cắt, hiện số khóa thật từ `totalKeys`.
- AC4: "Cố định" là mặc định, nền trơn, node không kéo được. "Kéo tự do" kéo được node bằng chuột, cảm ứng và bàn phím. Thả xong không có hai node chồng chữ, cách nhau tối thiểu 8 px (EXPERIENCE Y1). Có nút "Xếp lại". Kiểm bằng ảnh chụp sau khi kéo hai node chạm nhau.
- AC5: Không dùng `viewBox` co giãn, chữ giữ cỡ 12,5 px ở mọi chiều rộng. Ở 390 px trang không cuộn ngang, cây cuộn trong khung của nó.
- AC6: Nhãn kết luận hiện đúng nhãn truyền vào. Có bản tóm tắt văn bản cho trình đọc màn hình: số tầng, số trang, đường đi nếu có.
- AC7: Đủ `vi` và `en`, không chuỗi cứng. Playwright trên route thử, chụp ảnh 390 px và 1440 px ở hai ngôn ngữ lưu vào thư mục task. `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ca biên: cây một node (root là leaf); `path` trỏ trang không có trong `nodes` (bị ẩn) thì tô khối `hidden` tương ứng, không sập; `localStorage` bị chặn vẫn chạy.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, chạy thử thật, nhãn kết luận.
Đọc thêm: `DESIGN.md`; `EXPERIENCE.md` mục 6, 7 và Y1; `_bmad-output/SP001/STR002/Task004/mau_giao_dien.html` phần cây; `CLAUDE.md` mục "Giao diện B-Tree".
