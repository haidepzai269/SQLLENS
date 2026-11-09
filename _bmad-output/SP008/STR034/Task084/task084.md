# Task084: Cây B-Tree InnoDB từ thống kê thật & Trực quan hóa Rơi key 2 lần (Bookmark Lookup)

## 1. Mục tiêu & Bối cảnh
- **Story:** SP008 / STR034 (Dựng cây MySQL từ dữ liệu thật, đối chiếu `mysql.innodb_index_stats`).
- **Mục tiêu:** 
  - Thay thế trạng thái `not_simulated` của tab B-Tree trong MySQL bằng cây B+Tree trực quan được dựng từ cấu trúc bảng, dữ liệu mẫu thật và đối chiếu thống kê `mysql.innodb_index_stats`.
  - Trực quan hóa sự khác biệt cốt lõi của InnoDB:
    1. **Clustered Index (Primary Key):** Leaf page lưu toàn bộ dữ liệu dòng.
    2. **Secondary Index:** Leaf page lưu giá trị index key và giá trị Primary Key.
    3. **Rơi key 2 lần (Bookmark Lookup):** Khi tra cứu trên Secondary Index mà cần lấy thêm cột ngoài index, hoạt ảnh rơi key chạy trên Secondary Index tìm ra PK, sau đó nhảy tiếp sang Clustered Index (Primary Key) rơi lần 2 để bốc toàn bộ dữ liệu dòng.
    4. **Covering Index:** Khi query chỉ lấy các cột nằm trong Secondary Index, hoạt ảnh chỉ rơi trên 1 cây và hiển thị huy hiệu *"Covering Index - Không cần tra cứu lại bảng chính"*.
- **Nguyên tắc cốt lõi:**
  - Nguyên tắc 1: Cây B-Tree MySQL mang nhãn **`Mô phỏng`** (`Simulated`), vì dựng từ dữ liệu và thống kê thật, không đọc block raw `.ibd`.
  - Nguyên tắc 2: Tuyệt đối không nói "thiết kế này ổn".
  - Nguyên tắc 7: Không ghi log SQL của người dùng.
  - Nguyên tắc 8: Coi SQL là untrusted.

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC1 (Dựng cây B+Tree InnoDB):**
  - Xây dựng module `web/src/engines/mysql/btree-builder.ts` tạo `BTreeModel` cho cả Clustered Index (Primary Key) và Secondary Indexes từ schema bảng và dữ liệu mẫu.
  - Đọc thống kê từ `mysql.innodb_index_stats` hoặc `information_schema.innodb_indexes` để xác định số leaf page (`n_leaf_pages`) và tổng số trang (`size`).
- **AC2 (Gán nhãn `Mô phỏng` chuẩn mực):**
  - Tab B-Tree khi chọn engine MySQL hiển thị nhãn `Mô phỏng` kèm tooltip: *"Dựng từ cấu trúc dữ liệu và thống kê thật của InnoDB, không đọc trực tiếp file .ibd thô"*.
- **AC3 (Hoạt ảnh Rơi key 2 lần - Bookmark Lookup):**
  - Khi người dùng chọn tìm kiếm theo một giá trị trên Secondary Index (ví dụ cột `email`):
    - Hoạt ảnh GSAP cho viên bi rơi từ Root → Leaf trên cây Secondary Index tìm ra giá trị Primary Key (ví dụ `id = 42`).
    - Giao diện làm nổi bật tiếp cây Clustered Index (Primary Key), và viên bi tiếp tục rơi trên cây Clustered Index để lấy toàn bộ dữ liệu dòng.
    - Kèm câu giải thích song ngữ (vi/en) từng bước rơi.
- **AC4 (Minh họa Covering Index):**
  - Nếu câu query là Covering Index (chỉ chọn cột trong index), hệ thống phát hiện và hiển thị huy hiệu xanh *"Covering Index"* kèm câu giải thích: không cần nhảy sang Clustered Index.
- **AC5 (Range Scan trượt ngang trên Leaf):**
  - Hỗ trợ Range Scan trượt ngang qua danh sách liên kết kép (`doubly-linked list`) giữa các leaf page của InnoDB.
- **AC6 (Chất lượng code & Test):**
  - Unit tests cho `btree-builder.ts` kiểm tra chính xác cấu trúc nút, khóa và đối chiếu thống kê.
  - E2E Playwright test kiểm tra tab B-Tree MySQL hoạt động trơn tru trên cả Desktop 1440px và Mobile 390px, song ngữ `/vi` và `/en`.
  - `npm run check` (typecheck + lint + unit tests) đạt 100%.

## 3. File tác động & Tạo mới
- Tạo mới: `web/src/engines/mysql/btree-builder.ts` & `web/src/engines/mysql/btree-builder.test.ts`.
- Cập nhật: `web/src/engines/mysql/adapter.ts` (thay thế `no("btree")` bằng kết quả từ builder).
- Cập nhật: `web/src/modules/lab/stage/stage-data.ts` (chuyển đổi dữ liệu BTree cho giao diện).
- Cập nhật: `web/src/modules/btree-reader/anim/btree-drop.tsx` (hỗ trợ chuyển cảnh 2 cây cho MySQL Bookmark Lookup).
- Cập nhật: `web/messages/vi/btree.json` & `web/messages/en/btree.json` (bổ sung từ khóa bookmark lookup, clustered index).
- E2E test: `web/e2e/mysql-btree.spec.ts`.
