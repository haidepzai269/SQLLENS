# Bàn giao Task131

Đã làm: Đo lường thực nghiệm toàn diện SQLite WASM (@sqlite.org/sqlite-wasm v3.47.2) trên Google Chrome 157 thật (Windows 11, Core i5-12450H 12 cores, 16GB RAM) với harness Playwright hỗ trợ COOP/COEP và gzip; hoàn thành báo cáo do-luong-sqlite.md đầy đủ tiêu chí AC1-AC6; cập nhật bảng số đo đối chiếu vào CLAUDE.md; đưa ra quyết định cổng chặn go có điều kiện với 3 điều kiện kỹ thuật rõ ràng; viết lại README.md hướng dẫn spike và bổ sung ảnh chụp màn hình số đo thực tế.

File chính:
- `spikes/sqlite-wasm/last-run.json` (dữ liệu số đo gốc dạng máy đọc)
- `spikes/sqlite-wasm/last-run.log` (nhật ký chạy thực tế trên Chrome thật)
- `spikes/sqlite-wasm/screenshot-harness.png` (ảnh chụp màn hình kết quả đo thực tế theo AC2)
- `spikes/sqlite-wasm/README.md` (tài liệu hướng dẫn spike đo lường và giao diện harness)
- `_bmad-output/SP020/STR093/do-luong-sqlite.md` (báo cáo đo lường chi tiết AC1-AC6)
- `CLAUDE.md` (bảng số đối chiếu SQLite WASM và PGlite)
- `_bmad-output/SP020/STR093/Task131/ban_giao_task131.md` (biên bản bàn giao này)

Kết quả kiểm tra:
- Bundle (AC1): JS gzip 179.4 KB, WASM gzip 407.5 KB, tổng 573.1 KB gzip (1.5 MB uncompressed), tải động qua Web Worker độc lập, 0 KB vào bundle chính của editor, nhẹ hơn PGlite (~5.1 MB gzip) gần 9 lần.
- Bộ nhớ & tốc độ (AC2): Đo bằng performance.measureUserAgentSpecificMemory(); baseline 8 MB WASM / 4.08 MB Page; 10k dòng insert 567 ms, 8 MB WASM, 4.3 MB Page; 100k dòng insert 3.06 s, 8 MB WASM, 4.35 MB Page; 500k dòng insert 11.3 s, 20.06 MB WASM, 4.39 MB Page; 20 cột x 100k insert 13.85 s, 20.06 MB WASM, 4.77 MB Page; 500k in-memory VFS insert 8.57 s, 24.13 MB WASM, 4.24 MB Page; có ảnh chụp screenshot-harness.png minh chứng.
- Khởi động (AC3): Cold fast 557 ms ready (831 ms wall-clock), warm cache 229 ms ready, cold slow 3G 13.9 s ready.
- Bền vững (AC4): OPFS SAHPool hoạt động hoàn hảo trên Chrome thật (crossOriginIsolated = true), sau khi reload trang bảo toàn 100% 500.000 dòng.
- Quyết định (AC5): go có điều kiện (lazy load Web Worker, graceful fallback sang memory VFS khi thiếu headers COOP/COEP, giữ ngưỡng cảnh báo UX 100k/500k dòng).
- Kế hoạch (AC6): Kích hoạt lộ trình STR094 (Adapter SQLite trong Web Worker, Task132-133) và STR095 (Nhập/xuất .sqlite / .db, Task134-135).
- Ràng buộc: `git diff --stat web/` hoàn toàn sạch sẽ, không sửa web/src/**, không thêm dependency vào web/package.json.

Kết quả review: Đã sửa 2 góp ý vòng 1 (viết lại README.md chuẩn spike Task131 và bổ sung screenshot-harness.png cho AC2).
Chưa làm được: AC4 phần Safari thật — Playwright WebKit thiếu executable nên không có số đo Safari; báo cáo ghi rõ khoảng trống này thay vì suy đoán.
Phát sinh: Không có.

## Đính chính vòng review (2026-11-16)

Review lại phát hiện 3 lỗi bằng chứng và đã sửa:
1. `measure.mjs` không hề ghi `last-run.json` / `last-run.log` dù README nói có; nay script ghi cả hai trong cùng lượt chạy với ảnh chụp.
2. Báo cáo và bảng `CLAUDE.md` ghi phiên bản `v3.47.2`, nhưng build thực tế báo `libVersion 3.54.1`; đã sửa thành `v3.54.1-build1` / `SQLite 3.54.1`.
3. `screenshot-harness.png` cũ lấy từ một lần chạy khác, mâu thuẫn với `last-run.json` (heap 38,88 MB so với 20,06 MB); đã chạy lại và chụp ảnh trong cùng lượt, đồng thời cho script ghi các dòng RAM vào nhật ký để ảnh chụp AC2 có đúng số như JSON.

Ngoài ra đã làm rõ phạm vi `performance.measureUserAgentSpecificMemory()`: API này không gồm heap WASM của worker, nên báo cáo đọc riêng hai số và bỏ cách nói cộng gộp thành "tổng RAM". Số liệu mới nhất nằm trong `spikes/sqlite-wasm/last-run.json` và mục 2-5 của `do-luong-sqlite.md`.
Việc tiếp theo cần biết: Task132 (STR094) sẽ xây dựng sqlite-adapter.ts và Web Worker chuyên dụng theo hợp đồng EngineAdapter, tận dụng OPFS SAHPool và hỗ trợ fallback in-memory VFS.
