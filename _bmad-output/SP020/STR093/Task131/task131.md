# Task131: Đo bundle, RAM, thời gian khởi động SQLite WASM (cổng go/no-go)

Thuộc: SP020 / STR093
Mục tiêu: Có số thật để chủ dự án quyết định có làm engine SQLite hay không, thay vì quyết định bằng cảm giác.

Phạm vi:
- `spikes/sqlite-wasm/index.html` (harness đo, không phải sản phẩm)
- `spikes/sqlite-wasm/README.md` (cách chạy và cách đo)
- `_bmad-output/SP020/STR093/do-luong-sqlite.md` (báo cáo số)
- `CLAUDE.md` (thêm bảng số, không sửa mục khác)

Không làm:
- Không sửa `web/src/**`.
- Không thêm dependency vào `web/package.json`.
- Không cam kết engine SQLite sẽ được làm.

Hợp đồng:
- Harness đo tải WASM từ CDN hoặc bản copy trong `spikes/`, có nút: nạp DB, tạo bảng, chèn 10k/100k/500k dòng, chạy 1 SELECT đếm, xuất file.
- Báo cáo phải ghi rõ phiên bản thư viện, trình duyệt, máy đo.

Tiêu chí xong:
- AC1: Có số bundle: JS gzip, WASM gzip, tổng; và tổng đó có nằm ngoài bundle chính của editor không.
- AC2: Có RAM ở 10k, 100k, 500k dòng, ghi rõ cách đo (`performance.measureUserAgentSpecificMemory()` hoặc Chrome Task Manager), kèm ảnh chụp số.
- AC3: Có thời gian khởi động lần đầu và lần sau (cache), ghi cả mạng thường và throttled 3G nếu làm được.
- AC4: Có kết quả thử OPFS và persistence trên Chrome và Safari thật (nêu rõ Safari phiên bản nào).
- AC5: Báo cáo kết luận một trong ba: `go`, `no-go`, `go có điều kiện` (kèm điều kiện cụ thể).
- AC6: Nếu `no-go` thì ghi rõ ảnh hưởng tới STR094, STR095 và đề xuất thay thế, không tự đổi engine.

Ca biên: WASM tải lỗi giữa đường; Safari thiếu OPFS; bảng 20 cột × 500k dòng; máy chỉ 8GB RAM.
Kiểm tra: mở harness bằng Chrome thật, chạy 3 mức dữ liệu, ghi số vào báo cáo; đối chiếu `git diff --stat` để chắc không file sản phẩm nào bị sửa.
Góc review thêm: số liệu có tái lập được không (ghi đủ máy, trình duyệt, phiên bản), không được ghi "nhẹ" thay cho số.
Đọc thêm: `_bmad-output/SPEC_WORKSPACE_EXPORT_SHARE.md` mục về SQLite; `CLAUDE.md` phần số đo PGlite để so sánh.
