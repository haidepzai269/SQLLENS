# STR116 — Deadlock Arena: Đấu trường mô phỏng tranh chấp khóa

> Epic: SP024 | Trạng thái: **Chờ duyệt task**
> Điều kiện vào: **Task162 xong** (cần phòng để nhiều người vào xem cùng lúc)
> Thứ tự: **Tầng này chạy TRƯỚC Tầng 2 (STR113/114/115).** Không cần Yjs, không cần WebRTC, nên nó là thứ duy nhất trong SP024 giao được sớm.

## Mục tiêu

Phòng học trực quan nhiều người cùng xem kịch bản deadlock, bấm từng bước để thấy Wait-For Graph (Cytoscape) cập nhật màu sắc. Dùng lại `conflict-sim` 5 kịch bản + 13 biến thể chuẩn Postgres 18 đã có. **Nhãn Mô phỏng** bắt buộc. Không chạy hai engine thật đồng thời.

## Giao diện có

Có

## Nhãn

**Mô phỏng** (bắt buộc hiện ở mọi màn hình)

## Task

> Ba task nền phòng (Task160–162) nằm trong Epic này theo bản nháp v3 vì Arena cần phòng để nhiều người vào cùng link. Chúng không vẽ gì lên Arena.

| Task | Mô tả | Trạng thái |
|---|---|---|
| Task160 | Migration 006: schema phòng (invite token + Baton) | **Đã merge** (`84083ef`) nhưng **chưa qua review độc lập**. Party-mode review 2026-11-23 dựng lại được 6 lỗi; việc sửa giao `SP999/STR117/Task171`. Xem `Task160/ban_giao_task160.md` |
| Task161 | Gin API phòng: invite + Baton (mở rộng cloud API SP023) | **Xong 100%** — Reviewer độc lập nghiệm thu PASS 100% (5/5 AC, 9 ca biên, 8/8 package ok, 7 đột biến M1–M7). Đã merge vào `main`. Xem `Task161/ban_giao_task161.md` |
| Task162 | UI Mời cộng tác & danh sách thành viên | **Xong 100%** — Reviewer độc lập PASS 100% (vòng 3), đã merge vào `main`. Xem `STR113/Task162/ban_giao_task162.md` |
| Task168 | Arena: chọn kịch bản + điều hướng bước | **Xong 100%** — Reviewer độc lập nghiệm thu PASS 100% (23/23 tests, 0 byte mạng, AC1-AC6). Đã merge vào `main`. Xem `Task168/ban_giao_task168.md` |
| Task169 | Arena: đồ thị Cytoscape + viewer sync qua polling **3 s** gọi `arena-step` | Chờ (D17 đã chốt 2026-11-23) |
| Task170 | Arena: AI Mentor phân tích kịch bản (VIP only, gọi `/api/ai/inline-complete`) | Chờ |

## Tiêu chí nghiệm thu Story

- AC1: Chọn kịch bản → thấy từng bước với màu node đúng (xanh/vàng/đỏ/xám). Kịch bản lấy từ `scenarios.ts`: `lost_update`, `deadlock_reverse_order`, `write_skew`, `double_booking`, `non_repeatable_read`. **Không có kịch bản tên "Deadlock 2 chiều".**
- AC2: Nhãn **Mô phỏng** luôn hiện ở header (cả Host lẫn Viewer)
- AC3: Viewer sync step trong < 500 ms khi Host bấm Next
- AC4: AI Mentor chỉ hiện với VIP; prompt không nhúng SQL workspace. Endpoint thật là `/api/ai/inline-complete` (`api/internal/ai/ai.go:97,100`), **không phải** `/api/v1/ai/inline-complete`.
- AC5: Không có engine nào chạy thật trong Arena (đo: 0 PGlite instance)
- AC6: Đo được "polling 2 s có giữ Render thức không" trước khi chốt Task169. Xem D17.

> **D17 chưa xong:** bản nháp v2 khẳng định "polling cho Render ngủ bình thường" nhưng chưa ai đo. Poll 2 s từ một viewer đang mở trang là dòng request liên tục — đúng thứ giữ Render thức. Nền tháng đã là 512,5 h / 750 h (68,33 %), mở cả đêm thành 720 h (96 %). Task169 không được chốt tới khi có số đo.
