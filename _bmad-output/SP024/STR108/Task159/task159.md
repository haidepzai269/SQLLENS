# Task159: Cổng đo Tầng 0 cho Live Rooms

Thuộc: SP024 / STR108
Mục tiêu: Có số đo thật để chủ dự án quyết go/no-go cho Live Rooms, thay vì quyết bằng cảm giác.

Phạm vi:
- `spikes/live-rooms/**` (thư mục spike mới, tự chứa, không nối vào sản phẩm)
- `_bmad-output/SP024/STR108/Task159/ket_qua_do.md` (báo cáo)
- `_bmad-output/SP024/README.md` (chỉ cập nhật dòng trạng thái Task159)

Không làm:
- Không sửa gì trong `web/src/`, `api/internal/`, `web/messages/`. Đây là spike, không phải tính năng.
- Không thêm dependency vào `web/package.json` hay `api/go.mod`. Thư viện mới do phiên chính thêm. Spike dùng thư viện chuẩn.
- Không gọi Neon, Upstash, Render thật, Cloudflare. Không đăng ký dịch vụ mới. Đo trên máy.
- Không gửi SQL hay dữ liệu người dùng đi đâu. Spike chạy localhost.
- Không sửa Core Rule 7. Nếu thấy cần, ghi vào mục Phát sinh.

Hợp đồng: không có. Spike không xuất ra API cho task khác dùng.

Tiêu chí xong:

- **AC1 — Byte mỗi lần phát.** Đo trên Chromium thật, bản `next build` + `next start`: một dự án mẫu thực tế (3 tab, tab chính có câu SQL ~2 KB, một `EXPLAIN` plan, kết quả mẫu 100 dòng × 5 cột) mã hóa bằng codec SP022 (`encodeSnapshot`) rồi gzip + base64url. Ghi **số byte thật** của: (a) payload snapshot, (b) cùng dữ liệu đó dưới dạng URL fragment của `/share` hiện có. Hai số này phải đo trên cùng một dữ liệu. Nhãn **Thật**.
- **AC2 — Byte mỗi viewer.** Trả lời: một viewer nhận bao nhiêu byte mỗi phút, và bao nhiêu trong đó là **SQL của người dùng**. Đo bằng cách đếm byte thật trên dây (Playwright `page.on("response")` hoặc `request`, cộng `content-length`). Nhãn **Thật**. Đây là số dùng cho quyết định Core Rule 7 nên phải tách riêng dòng "byte là SQL người dùng".
- **AC3 — Plan và B-Tree có đi qua được không.** Văn kiện gốc hứa viewer "0 MB WASM vẫn xem Plan/B-Tree mượt". Đo xem dữ liệu B-Tree thật của một index 100k dòng (dùng `spikes/pglite-scale` sẵn có để sinh) nặng bao nhiêu byte khi tuần tự hóa, và phần nào của nó **chỉ** tính được bằng cách chạy engine. Ghi rõ: phần nào viewer xem được mà không cần WASM, phần nào không. Nhãn **Thật** cho byte, **Ước lượng** cho phần suy luận.
- **AC4 — Fan-out.** Dựng Gin local + `next start` local, cho 30 viewer kết nối đồng thời trong 10 phút ở chế độ polling (2 s) và chế độ SSE. Đo: số request, byte ra, RAM tiến trình Gin, RAM tiến trình Next, có rò kết nối không. Xác nhận SSE có sống qua `rewrites` của Next 16 với `compress: false` hay không (đây là điều `CLAUDE.md` ghi "chưa kiểm trên Vercel"). Nhãn **Thật**.
- **AC5 — Chi phí giờ Render.** Tính từ lịch `keep-awake.yml` thật (`*/10 0-16 * * *` = 07:00–23:50 giờ VN) và trần 750 giờ/tháng: một phòng live mở trong khung thức tốn thêm bao nhiêu giờ, mở ngoài khung tốn bao nhiêu. Nêu công thức và số đầu vào. Nhãn **Ước lượng** (vì chưa đo trên Render thật), và nói rõ vì sao là ước lượng.
- **AC6 — Kết luận go/no-go.** Một đoạn kết luận có số, nêu rõ 3 điều: (a) Live Rooms có rẻ hơn đáng kể so với link `/share` hiện có hay không, (b) phần nào của văn kiện gốc đứng được với số đo, phần nào không, (c) đề xuất go / no-go / go-có-điều-kiện. **Được phép kết luận "không nên làm"** — đó là kết quả thành công, không phải thất bại. Cấm làm tròn số theo hướng có lợi.

Ca biên:
- Snapshot vượt `SNAPSHOT_HARD_LIMIT_BYTES` (32 KB) và vượt `MAX_SNAPSHOT_TABS` (100): ghi lại chuyện gì xảy ra khi phát, có chặn được ở phía phát không.
- 0 viewer, 1 viewer, 30 viewer: có khác nhau về RAM server không.
- Viewer đóng tab đột ngột (giết tiến trình Chromium) giữa lúc SSE đang mở: server có nhả kết nối không, sau bao lâu.
- Mạng chậm 3G (Playwright throttling): SSE có bị đệm làm viewer thấy trễ không, trễ bao nhiêu ms.

Giao diện: không có màn hình sản phẩm. Trang đo trong spike chỉ để chạy, không cần i18n, không cần đẹp, nhưng phải ghi rõ trên trang đó là spike.

Kiểm tra:
- `cd spikes/live-rooms/server && go vet ./... && go build ./...`
- `cd spikes/live-rooms/web && npm run build` rồi Playwright như AC1/AC2/AC4 (dùng `next start`, không dùng `next dev`; `next dev` cho số sai).
- Chạy lại mỗi phép đo **3 lần**, ghi cả 3 và trung vị. Một lần chạy duy nhất không được tính là số đo.
- Tắt mọi server trước khi báo cáo (Windows khóa file).

Góc review thêm: nhãn kết luận (Thật / Mô phỏng / Ước lượng phải đúng chỗ); bảo mật (spike không được để lộ SQL ra ngoài localhost, không hardcode key); trung thực số liệu (reviewer phải chạy lại được ít nhất một phép đo và ra số cùng bậc).

Đọc thêm: `_bmad-output/Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md` (mục 3, 4, 6, 7), `_bmad-output/DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md`, `_bmad-output/SP024/README.md`, `web/src/modules/share/snapshot.ts` và `codec.ts`, `spikes/stream-cookie/` (mẫu spike SSE + rewrites đã có), `spikes/pglite-scale/`, dòng "Gọi Gin qua rewrites" trong `CLAUDE.md`.
