# SP002: Thử rủi ro

Kết quả: số đo thật để quyết định ở mốc cuối ngày 3. Epic này không giao tính năng. Mỗi task ghi số đo vào `ket_qua.md` trong thư mục task, rồi phiên chính chép kết luận vào `CLAUDE.md`.

Code thử nằm trong `spikes/<tên>/` ở gốc repo, mỗi thư mục có `package.json` hoặc `go.mod` riêng. Không sửa `web/` hay `api/`, để chạy song song với SP001.

## Story và Task

| Story | Task | Câu hỏi | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR007 PGlite trên trình duyệt | Task012 | Thời gian và RAM của PGlite ở 10k, 100k, 500k trong Chromium | Không | 1 |
| STR007 PGlite trên trình duyệt | Task013 | `pageinspect` và `pgsql-parser` có chạy trong Chromium không | Không | 1 |
| STR008 Cookie và stream | Task014 | Gọi qua `rewrites` có giữ cookie và stream không | Không, phần Vercel cần Task010 | 1 |
| STR009 Máy sandbox | Task015 | Một container MySQL tốn bao nhiêu RAM, khởi động mất bao lâu | Không | 1 |
| STR010 Lock wait MySQL | Task016 | Hai connection thật có bắt được lock wait và deadlock không | Không | 1 |
| STR011 Điều khoản và công cụ | Task017 | Điều khoản Render, Neon, LLM free, agent-browser trên Windows | Không | 1 |
| STR009 Máy sandbox | Task018 | Máy Azure chạy được bao nhiêu phiên cùng lúc | Máy Azure do chủ dự án tạo, Task015, Task016 | 2 |

## Các file bị đụng

| Task | File |
|---|---|
| Task012 | `spikes/pglite-scale/**` |
| Task013 | `spikes/pg-tools/**` |
| Task014 | `spikes/stream-cookie/**` |
| Task015 | `spikes/mysql-container/**` |
| Task016 | `spikes/mysql-lock/**` |
| Task017 | Chỉ thư mục task |
| Task018 | `spikes/azure-vm/**` |

Task015 và Task016 cùng chạy MySQL trong Docker: Task015 dùng tên container `t015-*` và cổng 33150 trở lên, Task016 dùng `t016-*` và cổng 33160 trở lên. Mỗi task xóa container của mình khi xong.
