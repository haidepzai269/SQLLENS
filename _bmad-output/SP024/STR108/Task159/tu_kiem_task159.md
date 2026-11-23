# Tự kiểm Task159 — không có reviewer độc lập

**Chưa có reviewer độc lập.** Session này là subagent ở độ sâu 1/1, hết lượt uỷ thác
(`subagent` và `subagent_fork` đều trả `remaining levels 0`), nên **không gọi được
reviewer mới** như `QUY_TRINH.md` yêu cầu. Toàn bộ phần dưới là **tự kiểm**, chạy
theo `bmad-review` với thấu kính đối kháng và thấu kính ca biên. Cần `lead` bố trí
reviewer độc lập trước khi coi Task159 là đã qua review.

Nội dung kiểm: diff `5e60a13..HEAD` (80 file, +10.687 dòng) và
`_bmad-output/SP024/STR108/Task159/ket_qua_do.md`.

## Thấu kính bỏ qua

- **verification-gap**: không áp dụng — đây là spike đo, không sửa hành vi sản phẩm
  (`web/src/`, `api/internal/` không bị chạm). Không có hành vi nào thay đổi để mà hụt kiểm.

## Phát hiện và cách xử lý

| # | Vị trí | Vấn đề | Xử lý |
|---|---|---|---|
| 1 | `ket_qua_do.md` mục AC2, dòng SQL | Nhân tỉ lệ SQL với **toàn bộ** byte thân, kể cả `hello`/`ping` không chở SQL → thổi số 1,2–3,5 % | **Đã sửa**: dùng thẳng 1.700 B mỗi payload × số `snapshot` |
| 2 | `ket_qua_do.md` mục AC2, dòng SQL phòng đứng yên | Báo 67,0 B/phút SQL trong khi phòng **không gửi snapshot nào** → phải là **0** | **Đã sửa** thành 0, kèm giải thích |
| 3 | `ket_qua_do.md` mục AC2 | Viết `1.700 / 3.906 = 43,49 %`; thực tế 1700/3906 = **43,52 %**, còn 43,49 % là 1700/3909 | **Đã sửa**: bỏ hẳn cách tính theo tỉ lệ, dùng byte tuyệt đối |
| 4 | `ket_qua_do.md` mục AC2, bảng tách chênh SSE/polling | Bản đầu ghi nguyên nhân chênh là "header" rồi bản sau ghi "mật độ phát"; phép tách số học của tôi sai (ra 26.250 thay vì 7.477,5) | **Đã sửa**: đo kích thước khung thật (`tools/frame-size.mjs`), tách 4 thành phần, ghi cả phần dư chưa giải thích (−177,4 B/phút) |
| 5 | `tools/ac2.mjs:123` | `publishesInWindow = floor(elapsed/EVERY_MS)` là số **danh nghĩa**; phòng đứng yên vẫn báo 6 | **Đã sửa**: đếm thật `publishesDone++` |
| 6 | `tools/ac4.mjs:166` | `sqlBytesPerViewerPerMinute` nhân tỉ lệ với **tổng** byte gồm cả route `publish` của host | **Đã sửa**: đổi tên thành `..._naiveWrong`, trỏ sang `ac4-recompute.mjs` |
| 7 | `ket_qua_do.md` mục AC4, ΔRAM | Khẳng định "tốn +0,1 MB" — nhưng các Δ có lần **âm** (−1,8), tức nằm trong nhiễu | **Đã sửa**: phát biểu đúng là "không thấy RAM tăng ở 30 viewer", không phải "tốn +0,1 MB" |
| 8 | `ket_qua_do.md` mục AC4, request `events` | Bảng ghi "30 request" trong khi `/metrics` đếm **0** | **Đã sửa** thành 0 + giải thích `count()` chỉ cộng sau khi handler trả về |
| 9 | `ket_qua_do.md` mục AC4, `sseEvents` | Số 1.785/3.555/5.325 là **cộng dồn** (reset không xóa biến này) | **Đã ghi rõ**; số mỗi lần = hiệu = 1.770; lần 1 ghi "không suy được" |
| 10 | `ket_qua_do.md` mục "Chưa đo được" | Chưa nêu rằng codec là **gzip**, không phải Brotli như văn kiện gốc giả định | **Đã thêm** dòng riêng |
| 11 | `ket_qua_do.md` mục AC1 | Rủi ro trình bày payload live (3.906 B) như "đắt hơn" /share (1.860 B) mà không nói phần lớn là plan + kết quả | **Đã sửa**: nêu rõ 3 tab qua cùng codec ra **cùng số byte**; phần nặng thêm là plan + kết quả, tức giá của việc viewer không chạy engine |
| 12 | `ket_qua_do.md` mục AC5 | "0 giờ thêm" dễ đọc thành "miễn phí" | **Đã thêm** 3 điều kiện kèm theo (service thứ hai = 136,67 % trần; chưa biết Render tính SSE mở là lưu lượng; cron chạy trễ) |

## Đã kiểm lại bằng số, khớp JSON thô

Đối chiếu từng con số trong báo cáo với `web/results/*.json`:

- **AC1**: 3.909 / 3.901 / 3.906 B, /share 1.860 B, `sqlAttributableLive` 1.700 / 1.701 / 1.700, planJson 2.256 / 2.256 / 2.253, result 5.595 B — **khớp**.
- **AC2**: 1 request, thân 20.186 / 20.231 / 20.192, header 203, B/phút 19.364,6 / 19.429,5 / 19.384,1; polling 32 request, 26.906,9 / 26.907,0 / 26.952,8 — **khớp**.
- **AC3**: plan 551/324/434 B; `orders_customer_id_idx` 18.775 JSON / 5.941 gzip / 7.905 payload, cao 2, 89 trang, 2.087 khóa; `orders_pkey` 2.653 payload, 276 trang, 3 trang đọc, `hidden [{level:0,count:272}]`, `keysInModel` 474/1.006; payload đầy đủ 13.841 B — **khớp**.
- **AC4**: byte `events` 7.107.277 / 7.108.177 / 7.109.310; `poll` 7.120.530 / 7.121.430 / 7.122.600; trạng thái `{poll_200:1800, poll_304:7237/7238/7243}`; cửa sổ 601.149 / 601.125 / 601.069 ms; RAM Gin 11,2→12,4 / 14,9→15,1 / 15,2→15,2, Next 82,2→83,1 / 79,8→80,9 / 66,6→67,8 — **khớp**.
- **AC5**: 17,0833 h/ngày, nền 512,5 h (68,33 %), headroom 237,5 h, ngoài khung 30 phút +0,75 h, suốt đêm +207,5 h = 720 h (96,00 %), hai service 1.025 h (136,67 %) — **khớp**.
- **Trọng lượng trang**: `/viewer` 462.569 B / 139.361 B nén, wasm 0, worker 0; `/ac1` 16.692.968 B, wasm 15.637.266 B, 1 worker — **khớp**.

## Chưa làm được

- **Không có reviewer độc lập** (lý do ở đầu file). Đây là điều kiện của `QUY_TRINH.md` mà task này chưa thoả.
- Không kiểm được `DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md`: file không tồn tại trong worktree.
