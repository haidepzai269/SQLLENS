# Mục tiêu trước mắt (Cập nhật ngày 2026-11-10 — CHÍNH THỨC SẴN SÀNG PHÁT HÀNH V1)

> **Cập nhật ngày 2026-11-10 (Ngày 5 của dự án):**
> Toàn bộ **13 Epics** và **60/61 Stories (98.4%)** đã hoàn thành 100%!
> - **Đợt 4C (Task082):** Security Audit toàn diện 3 tầng, quét secret, rà soát 100% nhãn kết luận và câu chữ giao diện không thiên vị, regression suite 572 tests unit + Playwright E2E pass 100%, chốt `RELEASE_CHECKLIST_V1.md` sẵn sàng phát hành.
> - **Đợt 5 Toàn diện:** Mở rộng sandbox MySQL Docker trên Azure VM, cây B+Tree InnoDB, Thử sửa Shadow Tables, Tranh chấp 2 connection SSE stream realtime.
> - **Gọt giũa UX (Task090):** Header SQL cố định (sticky), đưa nút Chạy (icon Play tam giác SVG) & nút Sinh dữ liệu lên header, vi tương tác Debounce Tooltip "Ấn để chạy" (574 unit tests pass).
> Đã bàn giao **85 Tasks**. SQLLens V1 chính thức đạt tiêu chuẩn phát hành sản phẩm ra cộng đồng! Đang thảo luận duyệt SPEC Epic SP014 (Smart Error Helper & Quick-Fix).

---

## 1. Trạng thái hiện tại & Thành quả đã chốt

### A. Các đợt đã hoàn thành (100% CI xanh & đã bàn giao):
- **Đợt 1 (Nền tảng & Giao diện):** Đạt chuẩn shadcn/ui (Task064), trang `/about` GSAP (Task067), HTTPS & sandbox agent cho MySQL (Task074), ổn định CI E2E (Task077), chặn các route `e2e-*` trên production.
- **Đợt 2 (Đăng nhập, Rủi ro & Tranh chấp):** Trang `/login` GSAP có quota (Task066), Findings gắn bằng chứng plan/btree vào luật rủi ro (Task052, Task053, Task068, Task069, Task076), Conflict-sim timeline 2 session & đồ thị chờ khóa Cytoscape (Task070), tiêu chí hỏng tùy biến bằng SELECT (Task079).
- **Đợt 3 (B-Tree Reader trực quan):** Range scan trượt ngang leaf & bước nhảy heap (Task072), Cuộc đua Seq Scan vs Index Scan bằng số trang/dòng thật & Cây B-Tree tối khi query không dùng được index (Task078).
- **Đợt 4A (Đánh bóng luồng & Trợ năng):** Empty states trên 7 tabs, Conflict Sim chạy độc lập, phím tắt `Ctrl+Enter`, `Space` pan canvas, Error Boundary bảo vệ từng tab, `prefers-reduced-motion` trong GSAP, CSS `cursor: pointer` toàn cục (Task080).
- **Đợt 4B (E2E Suite trọn vẹn):** Playwright Golden Path 10 bước (Desktop 1440px & Mobile 390px, song ngữ vi/en) (Task081).
- **Đợt 4C (Security Audit & Release Checklist V1):** Rà soát an ninh 3 tầng, quét secret, anti-bias audit, đồng bộ tooltip cho mọi nhãn kết luận, `RELEASE_CHECKLIST_V1.md` (Task082).
- **Đợt 5 (Sandbox MySQL Azure VM):** Task083, Task084, Task085, Task086 thông mạng Render ↔ Azure VM, B+Tree InnoDB, Shadow Table What-if, Conflict SSE stream.

---

## 2. Lộ trình Đã Hoàn Tất

| Mốc | Story | Việc cần làm | Kết quả |
|---|---|---|---|
| **Đợt 4A** | **SP013 / STR059** | Đánh bóng luồng, loading, empty states, phím tắt, trợ năng | **Đã hoàn thành 100% (Task080)** |
| **Đợt 4B** | **SP013 / STR060** | Playwright E2E Suite Golden Path 10 bước | **Đã hoàn thành 100% (Task081)** |
| **Đợt 4C** | **SP013 / STR061** | Security Audit toàn diện, rà soát nhãn kết luận, quét secret & Chốt Release Checklist V1 | **Đã hoàn thành 100% (Task082)** |
| **Đợt 5A** | **SP004 / STR019** | Nối Gin backend với sandbox agent trên Azure VM, bật tab MySQL thật | **Đã hoàn thành 100% (Task083)** |
| **Đợt 5B** | **SP008 / STR034** | Dựng B+Tree InnoDB từ dữ liệu thật, Bookmark Lookup rơi key 2 lần, Covering Index | **Đã hoàn thành 100% (Task084)** |
| **Đợt 5C** | **SP010 / STR044** | Thử sửa What-if trên MySQL Shadow Table `__whatif_*`, DDL auto-commit | **Đã hoàn thành 100% (Task085)** |
| **Đợt 5D** | **SP011 / STR050** | Tranh chấp 2 connection MySQL thật qua SSE stream, 4 kịch bản thực chiến | **Đã hoàn thành 100% (Task086)** |

---

### Tính năng linh hoạt (Không chặn phát hành):
- **SP012 / STR057 (AI Chaos Generator):** Dùng AI tự sinh kịch bản tranh chấp 2 session từ schema người dùng. Chỉ làm nếu còn dư dả thời gian sau khi hoàn tất Đợt 4.
- **SP002 / STR011 (Điều khoản & chính sách):** Hoàn thiện văn bản chính sách dữ liệu và giới hạn tài nguyên.

---

## 3. Việc của Chủ dự án (Cần làm khi thuận tiện)

1. **Bảo mật Secret:** Đổi 4 secret đã lộ trong lịch sử phiên cũ: mật khẩu Neon, token Upstash, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`. Cập nhật trên Render Dashboard và `api/.env`.
2. **AI Production:** Điền `GROQ_API_KEY` trên Render (nếu chưa điền) và bật Zero Data Retention của Groq.
3. **Mở cổng MySQL (Đã xong):** Chủ dự án đã cấu hình mở cổng Azure NSG, ufw và thiết lập biến môi trường trên Render thành công.

---

## 4. Việc tiếp theo ngay của Agent

Bắt tay vào **Đợt 4C — SP013 / STR061 (Task082: Security Audit toàn diện, rà soát 100% nhãn kết luận, quét secret & Chốt Release Checklist V1)** để sẵn sàng phát hành chính thức SQLLens!
