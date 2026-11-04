# Task074: Đường HTTPS từ Gin tới sandbox agent, giới hạn theo người dùng

Thuộc: SP004 / STR019
Mục tiêu: Gin chuyển yêu cầu MySQL của người dùng đã đăng nhập tới agent qua HTTPS có chứng chỉ ghim, với giới hạn theo người dùng, để đủ các điều kiện Task037 đặt ra trước khi mở cổng.
Phạm vi: `sandbox/agent/**`, `api/internal/mysql/**`, `api/cmd/server/main.go` (chỉ chỗ nối), `api/internal/auth/auth.go` (chỉ bỏ route tạm khi đã thay), `api/.env.example`, `render.yaml`, `_bmad-output/SP004/STR019/Task074/huong_dan_mo_cong.md`.
Không làm: `EngineAdapter` MySQL và màn hình ở frontend (Task075). Không đổi NSG, `ufw`, SSH, không tạo xóa tài nguyên Azure. Không ghi IP công khai hay đường dẫn khóa SSH vào repo.

Hợp đồng:
- Agent thêm một cổng HTTPS dùng chứng chỉ tự ký sinh trên máy, chạy cùng các lớp hiện có. Cổng loopback hiện tại giữ nguyên hoặc thay thế, ghi rõ lựa chọn. Khóa riêng quyền 600, chỉ đọc bởi service.
- Biến của Gin: `SANDBOX_URL`, `SANDBOX_TOKEN`, `SANDBOX_CERT_SHA256`. Thiếu biến nào thì MySQL trả 503 `not_configured`, phần khác vẫn chạy. Gin ghim đúng vân tay chứng chỉ, sai vân tay thì từ chối và không gửi token.
- Route Gin, sau `a.Gate`: `POST /mysql/sessions`, `POST /mysql/sessions/:id/query`, `GET /mysql/sessions/:id/locks`, `DELETE /mysql/sessions/:id`. Thân và mã lỗi giữ theo agent nếu có thể, ghi hợp đồng cho Task075 vào bàn giao.
- Agent lưu chủ phiên là mã băm của user id do Gin gửi. Trạng thái phiên vẫn nằm ở agent theo quyết định trong `CLAUDE.md`, nên Render restart không mất phiên. Người dùng khác gọi vào phiên không phải của mình nhận cùng lỗi 404 như phiên không tồn tại.
- `quota.MySQLSession` chỉ tính khi tạo phiên. Câu lệnh dùng rule riêng.

Tiêu chí xong:
- AC1: Sai vân tay, chứng chỉ hết hạn, hoặc máy chủ giả đều bị từ chối, token không bị gửi. Test bằng máy chủ TLS giả và kiểm máy chủ không nhận được header `Authorization`.
- AC2: Người dùng A không đọc, chạy, hay hủy được phiên của B, cả khi đoán đúng id.
- AC3: Giới hạn theo người dùng đủ ba loại mà Task037 yêu cầu: số phiên đồng thời, tần suất câu lệnh, tổng thời gian câu lệnh mỗi ngày. Có số mặc định ở đầu file với lý do, dựa trên máy 2 phiên. Upstash lỗi thì từ chối. Một người không thể giữ cả 2 phiên của máy khi có người khác chờ, nên trần mặc định là 1 phiên mỗi người.
- AC4: Không có SQL, kết quả, token, id người dùng gốc trong log của Gin và agent. Test chụp log có chuỗi đánh dấu.
- AC5: Thân trên 1 MiB trả 413. Kết quả chuyển về có giới hạn kích thước. Trình duyệt ngắt kết nối thì yêu cầu tới agent bị hủy. Agent lỗi hoặc không tới được trả mã lỗi riêng, không treo quá thời hạn.
- AC6: Agent mới chạy thật trên máy Azure qua systemd, nghe cổng HTTPS. Kiểm từ chính máy đó và qua SSH tunnel, gồm tạo phiên, chạy SQL, lock wait, hủy. NSG chưa mở nên từ ngoài vẫn không tới được cổng này, kiểm và ghi lại. Token mới được sinh bằng nguồn ngẫu nhiên mạnh, tối thiểu 32 byte, không in ra log hay báo cáo.
- AC7: Chạy lại các bước của Task037 cho đường mới theo skill `security-audit`, kèm kiểm TLS, ghi kết quả vào bàn giao. Lỗi nghiêm trọng hoặc cao phải sửa.
- AC8: `huong_dan_mo_cong.md` viết từng bước cho chủ dự án: mở cổng nào, dải IP Render lấy ở đâu, đọc token và vân tay bằng lệnh SSH nào, đặt biến nào trên Render, kiểm thế nào, và cách đóng lại khi có sự cố. Không ghi giá trị thật.
- AC9: `gofmt`, `go vet ./...`, `go test -count=1 ./...` đạt trong cả `api/` và `sandbox/agent/`.

Ca biên: hai yêu cầu tạo phiên cùng lúc của một người; agent restart giữa phiên, trả phiên không tồn tại; id phiên có ký tự lạ; phiên hết hạn; token rỗng.
Góc review thêm: bảo mật theo `ATTACK-CLASSES.md`, phần SSRF, xác thực, cô lập phiên, log.
Đọc thêm: bàn giao Task035, Task037, Task042, Task043; `CLAUDE.md` dòng "Đường mạng Render tới máy Azure".
