# Mục tiêu trước mắt (Cập nhật ngày 2026-11-09)

> **Cập nhật ngày 2026-11-09 (Ngày 5 của dự án):**
> Toàn bộ **Đợt 1, Đợt 2, Đợt 3, Đợt 4A, Đợt 4B, Đợt 5A** và **Đợt 5B** đã hoàn thành 100%! 
> - Luồng lõi PostgreSQL trọn vẹn (Dán SQL → Schema/Plan visualizer → B-Tree Reader range scan & cuộc đua & cây tối → Findings rủi ro gắn bằng chứng → What-if rollback → Conflict-sim 5 kịch bản & tiêu chí hỏng tùy biến → AI Mentor proxy) kèm đánh bóng luồng và bộ test Playwright E2E Golden Path 10 bước (Desktop 1440px & Mobile 390px, song ngữ vi/en) đã hoạt động xuất sắc.
> - **Đột phá MySQL (Đợt 5A & Đợt 5B):** 
>   + Thông mạng thật Render ↔ Azure VM, chạy thử nghiệm thực tế câu lệnh MySQL trên production thật với nhãn `Thật` (Task083).
>   + Dựng cây B+Tree InnoDB từ dữ liệu thật mang nhãn `Mô phỏng`, trực quan hóa hoạt ảnh rơi key 2 lần (Bookmark Lookup) từ Secondary Index sang Clustered Index và nhận diện Covering Index (Task084).
> Đã bàn giao **78 Tasks**, hoàn tất **57/61 Stories (93.4%)**. Chỉ còn **4 Stories (6.6%)**!

---

## 1. Trạng thái hiện tại & Thành quả đã chốt

### A. Các đợt đã hoàn thành (100% CI xanh & đã bàn giao):
- **Đợt 1 (Nền tảng & Giao diện):** Đạt chuẩn shadcn/ui (Task064), trang `/about` GSAP (Task067), HTTPS & sandbox agent cho MySQL (Task074), ổn định CI E2E (Task077), chặn các route `e2e-*` trên production.
- **Đợt 2 (Đăng nhập, Rủi ro & Tranh chấp):** Trang `/login` GSAP có quota (Task066), Findings gắn bằng chứng plan/btree vào luật rủi ro (Task052, Task053, Task068, Task069, Task076), Conflict-sim timeline 2 session & đồ thị chờ khóa Cytoscape (Task070), tiêu chí hỏng tùy biến bằng SELECT (Task079).
- **Đợt 3 (B-Tree Reader trực quan):** Range scan trượt ngang leaf & bước nhảy heap (Task072), Cuộc đua Seq Scan vs Index Scan bằng số trang/dòng thật & Cây B-Tree tối khi query không dùng được index (Task078).
- **Đợt 4A (Đánh bóng luồng & Trợ năng):** Empty states trên 7 tabs, Conflict Sim chạy độc lập, phím tắt `Ctrl+Enter`, `Space` pan canvas, Error Boundary bảo vệ từng tab, `prefers-reduced-motion` trong GSAP, CSS `cursor: pointer` toàn cục (Task080).

---

## 2. Lộ trình nước rút về đích (13% còn lại)

Chia làm 2 lộ trình rõ ràng để không bị phụ thuộc chéo:

### Lộ trình 1: Đánh bóng & Phát hành V1 PostgreSQL (Ưu tiên số 1 — Không phụ thuộc hạ tầng ngoài)
Mục tiêu: Đưa SQLLens PostgreSQL hoàn chỉnh, bóng bẩy, bảo mật tuyệt đối lên production cho người dùng cuối.

| Mốc | Story | Việc cần làm | Kết quả người dùng thấy |
|---|---|---|---|
| **Đợt 4A** | **SP013 / STR059** (Đánh bóng luồng) | **Task080:** Rà soát và đánh bóng toàn diện các trạng thái: loading skeleton, empty states, error boundaries cho cả 7 tab stage; hỗ trợ phím tắt (`Ctrl+Enter` chạy SQL, `Space` kéo canvas sơ đồ); `cursor: pointer` toàn cục; kiểm tra `prefers-reduced-motion` toàn trang. | **Đã hoàn thành 100% (bàn giao Task080)** |
| **Đợt 4B** | **SP013 / STR060** (E2E Suite trọn vẹn) | **Task081:** Xây dựng bộ test Playwright E2E chạy xuyên suốt luồng người dùng chính từ Landing → Editor → Sơ đồ/Plan/BTree → Findings → What-if → Conflict-sim trên cả tiếng Việt (`/vi`) và tiếng Anh (`/en`). | **Đã hoàn thành 100% (bàn giao Task081)** |
| **Đợt 4C** | **SP013 / STR061** (Kiểm tra cuối & Security Audit) | **Task082:** Chạy `security-audit` toàn diện, quét secret, kiểm tra sandbox injection, rà soát 100% nhãn kết luận trên UI (đảm bảo không còn câu nào hàm ý "thiết kế này ổn" theo Nguyên tắc 2). | Tự tin bấm nút phát hành chính thức V1. |

---

### Lộ trình 2: Mở rộng Sandbox MySQL (Sau khi Chủ dự án mở cổng Azure)
Mục tiêu: Kích hoạt engine MySQL thật chạy trên Docker VM Azure.

| Mốc | Story | Việc cần làm | Điều kiện kích hoạt |
|---|---|---|---|
| **Đợt 5A** | **SP004 / STR019** | **Task083:** Nối Gin backend với sandbox agent trên Azure VM; bật tab MySQL trên frontend; hiển thị trạng thái đang khởi tạo container / hết hạn / hàng đợi. | **Đã hoàn thành 100% (bàn giao Task083, nghiệm thu thực tế trên production)** |
| **Đợt 5B** | **SP008 / STR034** | **Task084:** Dựng lại cây B-Tree InnoDB từ dữ liệu thật, đối chiếu `mysql.innodb_index_stats`, trực quan hóa rơi key 2 lần (Bookmark Lookup) và Covering Index. | **Đã hoàn thành 100% (bàn giao Task084)** |
| **Đợt 5C** | **SP010 / STR044** | Thử sửa What-if trên bảng clone tạm của MySQL (vì `CREATE INDEX` tự commit). | Sau Đợt 5A. |
| **Đợt 5D** | **SP011 / STR050** | Tranh chấp 2 connection MySQL thật, đọc `performance_schema.data_lock_waits`, dirty read ở `READ UNCOMMITTED`. | Sau Đợt 5A. |

---

### Tính năng linh hoạt (Không chặn phát hành):
- **SP012 / STR057 (AI Chaos Generator):** Dùng AI tự sinh kịch bản tranh chấp 2 session từ schema người dùng. Chỉ làm nếu còn dư dả thời gian sau khi hoàn tất Đợt 4.
- **SP002 / STR011 (Điều khoản & chính sách):** Hoàn thiện văn bản chính sách dữ liệu và giới hạn tài nguyên.

---

## 3. Việc của Chủ dự án (Cần làm khi thuận tiện)

1. **Bảo mật Secret:** Đổi 4 secret đã lộ trong lịch sử phiên cũ: mật khẩu Neon, token Upstash, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`. Cập nhật trên Render Dashboard và `api/.env`.
2. **AI Production:** Điền `GROQ_API_KEY` trên Render (nếu chưa điền) và bật Zero Data Retention của Groq.
3. **Mở cổng MySQL (Nếu muốn kích hoạt Lộ trình 2):** Làm theo hướng dẫn tại [`_bmad-output/SP004/STR019/Task074/huong_dan_mo_cong.md`](file:///c:/SQLLens/_bmad-output/SP004/STR019/Task074/huong_dan_mo_cong.md) để mở cổng Azure NSG cho IP của Render.

---

## 4. Việc tiếp theo ngay của Agent

Bắt tay ngay vào **Đợt 5C — SP010 / STR044 (Task085: Thử sửa What-if trên MySQL qua cơ chế bảng Shadow `__whatif_*`, giải quyết DDL auto-commit)**!
