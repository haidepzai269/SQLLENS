# Task035: Sandbox agent

Thuộc: SP004 / STR016
Điều kiện bắt đầu: Task036 đã merge.
Mục tiêu: Một dịch vụ chạy trên máy Azure tạo, chạy SQL, hủy phiên MySQL qua HTTP, có xác thực, có trần số phiên, tự dọn phiên hết hạn. Trạng thái phiên nằm ở agent nên Render khởi động lại không mất phiên.
Phạm vi: `sandbox/agent/**` (Go, `go.mod` riêng), `_bmad-output/SP004/STR016/Task035/**`.
Không làm: mở agent ra Internet hay chọn đường mạng từ Render (chờ chủ dự án chốt), Gin gọi agent (STR019), sửa `sandbox/mysql-seed/**` ngoài việc gọi script của nó.

Hợp đồng:
- Agent chỉ nghe `127.0.0.1`. Xác thực bằng header `Authorization: Bearer <token>`, token đọc từ file quyền 600, không nằm trong repo. So token bằng phép so thời gian hằng.
- `POST /sessions` trả `{ id, expiresAt }`. `id` ngẫu nhiên, không đoán được. Hết chỗ trả 429 với mã lỗi `sandbox_full`.
- `POST /sessions/{id}/query` nhận `{ sql: string, connection?: "a" | "b" }`, chạy bằng `sqllens_user`, trả kết quả theo kiểu `QueryResult` của `web/src/contracts/engine.ts`. Hai kết nối `a` và `b` giữ riêng trong suốt phiên, cho `conflict-sim` sau này.
- `GET /sessions/{id}/locks` đọc `performance_schema.data_lock_waits` và `data_locks` bằng root.
- `DELETE /sessions/{id}` hủy phiên. `GET /healthz` không cần token, không lộ số phiên.
- Lỗi theo định dạng lỗi API trong `web/src/contracts/api-error.ts`.
- Không ghi SQL người dùng vào log. Log chỉ có loại sự kiện, id phiên rút gọn, thời gian.

Ràng buộc từ Task036:
- SQL người dùng gửi qua driver MySQL của Go, không qua client `mysql` (`-e` hay stdin), vì client cho chạy shell bằng `!`. `session.sh exec` chỉ dùng cho quản trị, không đưa tham số hay SQL người dùng vào.
- `sqllens_user` chỉ có host `@localhost` và container chạy `--network none`. Kết nối bằng unix socket của phiên. Không mở mạng cho container. Nếu buộc phải đổi thì dừng và báo phiên chính.
- `max_execution_time` chỉ giới hạn `SELECT` và người dùng đặt lại được, nên agent tự `KILL QUERY` bằng root khi quá hạn, với mọi loại câu.
- Chưa có hạn mức đĩa theo phiên. Agent phải chặn được một phiên làm đầy đĩa máy, ví dụ theo dõi dung lượng thư mục phiên và hủy phiên khi vượt mức. Ghi mức đã chọn.

Tiêu chí xong:
- AC1: Trên máy Azure, tạo phiên, chạy `CREATE TABLE`, `INSERT`, `SELECT`, nhận đúng dòng, rồi hủy. Thời gian tạo phiên ghi vào `ket_qua.md`.
- AC2: Trần 2 phiên theo Task034: phiên thứ ba trả 429. Hai yêu cầu tạo phiên đến cùng lúc vẫn khởi động tuần tự, không vượt trần.
- AC3: Phiên hết hạn, mặc định 15 phút không hoạt động, tự bị hủy, container và thư mục bị xóa. Có test với hạn ngắn.
- AC4: Khởi động lại agent: phiên còn hạn vẫn dùng được, hoặc bị dọn sạch và trả 404 rõ ràng. Không để sót container. Ghi cách đã chọn.
- AC5: Thiếu token, sai token, id phiên của người khác: đều bị từ chối và không lộ phiên có tồn tại hay không.
- AC6: Kịch bản lock wait của Task016 chạy qua API với kết nối `a` và `b`, `GET /locks` thấy chờ khóa.
- AC7: Câu chạy lâu bị cắt theo giới hạn thời gian và trả lỗi rõ, kể cả `UPDATE` lớn và khi người dùng đã `SET SESSION max_execution_time = 0`. Phiên ghi quá hạn mức đĩa bị dừng, máy không đầy đĩa. Kết quả trên 10.000 dòng bị cắt và báo đã cắt. Body yêu cầu trên 1 MB bị từ chối.
- AC8: `grep` log agent sau AC1 đến AC7 không thấy nội dung SQL. `go vet` và `go test ./...` thoát với mã 0.
- AC9: Agent chạy như service systemd, tự khởi động lại khi chết. Dọn hết phiên thử khi xong, máy vẫn chạy.

Ca biên: hủy phiên đang chạy câu dài; tạo phiên khi đĩa còn ít; SQL có nhiều câu cách nhau bằng dấu chấm phẩy.
Kiểm tra: `cd sandbox/agent && go vet ./... && go test ./...`; AC1 đến AC9 trên máy Azure.
Góc review thêm: bảo mật theo `ATTACK-CLASSES.md` của skill `security-audit` phần xác thực, injection, tài nguyên.
Đọc thêm: bàn giao Task034, Task036; `ket_qua.md` Task016; `CLAUDE.md` nguyên tắc 7, 8 và mục máy Azure.
