# SP024: Live Rooms — Phòng cộng tác nhiều người

Trạng thái: **MỞ, chỉ Tầng 0**. Chủ dự án chốt ngày 2026-11-22: làm song song với SP013 và SP999, đo trước rồi mới xây.

## Vì sao Epic này tồn tại

Chủ dự án đề xuất biến SQLLens thành nền tảng cộng tác nhóm. Văn kiện gốc ở `_bmad-output/Y_TUONG_TEAM_MULTIPLAYER_COLLABORATION.md`. Bản phản biện và đề xuất story ở `_bmad-output/DE_XUAT_STORY_SP024_TEAM_MULTIPLAYER.md`.

Văn kiện gốc không có một số đo nào, nên Epic này **không** bắt đầu bằng code. Nó bắt đầu bằng một cổng đo.

## Quyết định của chủ dự án ngày 2026-11-22

| # | Câu hỏi | Chủ dự án trả lời |
|---|---|---|
| 1 | SQL rời khỏi trình duyệt (Core Rule 7) | **Ghi nợ.** Chưa quyết. Không được tự đổi Core Rule 7. Đây là cổng chặn mọi story có gửi SQL qua mạng. |
| 2 | Đo trước hay xây thẳng | **Đo trước, làm ngay.** |
| 3 | "Một người viết, nhiều người xem" có đủ không | **Không.** Cấp quyền khi chia sẻ; ai có quyền chỉnh sửa thì được sửa, ai không thì chỉ xem. Nhiều người sửa và nhiều người xem cùng lúc. |
| 4 | Thứ tự với SP013/SP999 | **Song song.** |

## Ranh giới phải giữ

- Quyết định 3 nói về **quyền trên tài liệu**, không nói engine chạy ở đâu. Engine vẫn chỉ chạy được trên máy một người tại một thời điểm (PGlite một phiên). Cách biến "nhiều người có quyền sửa" thành chuyện chạy được là nội dung của Tầng 2, chưa mở.
- Core Rule 7 đang **nợ**, không phải đã cho phép. Mọi số đo ở Tầng 0 phải nêu rõ: số này có gửi SQL ra khỏi máy hay không.

## Các tầng

| Tầng | Nội dung | Trạng thái |
|---|---|---|
| 0 | Đo & quyết định (STR108 / Task159) | **Xong** (merge `33ff8d7`) — đo đủ 6 AC, 3 lần mỗi phép, qua review độc lập. Kết luận **no-go cho Live Rooms**. Xem `STR108/Task159/ket_qua_do.md` |
| 1 | Live Presentation: host phát, N viewer xem | **Không làm** — cổng Tầng 0 kết luận no-go (`STR108/Task159/ket_qua_do.md`) |
| 2 | Nhiều người sửa: quyền khi chia sẻ, soạn thảo chung, chạy engine có kiểm soát | Chưa mở |
| 3 | Đấu trường tranh chấp, nhãn Mô phỏng | Chưa mở |

## Việc đã làm

| Task | Nội dung | Trạng thái |
|---|---|---|
| Task159 | Cổng đo Tầng 0 | **Xong** (merge `33ff8d7`) — đo đủ 6 AC, 3 lần mỗi phép. Review độc lập chấm **no-go** đứng vững trên 6 lý do riêng; 5 lỗi Trung bình và 8 lỗi Thấp đã sửa ở `4e908c7` + `663cb16`. Báo cáo: `STR108/Task159/ket_qua_do.md`. Bàn giao: `STR108/Task159/ban_giao_task159.md` |
