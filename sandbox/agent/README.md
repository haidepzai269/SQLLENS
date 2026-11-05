# sandbox/agent

Dịch vụ Go chạy trên máy Azure: tạo, chạy SQL, hủy phiên MySQL qua HTTP. Chỉ nghe `127.0.0.1` (từ chối địa chỉ khác lúc khởi động). Xem `_bmad-output/SP004/STR016/Task035/`.

Môi trường: `AGENT_ADDR` (127.0.0.1:8081), `TOKEN_FILE` (/etc/sqllens-agent/token, quyền 600, ít nhất 32 ký tự), `SESSION_SH`, `SESS_ROOT`, `MAX_SESSIONS` (2), `IDLE_TTL_SEC` (900), `QUERY_TIMEOUT_SEC` (15), `DISK_LIMIT_MB` (512).

API (Bearer token, trừ `/healthz`): `POST /sessions`, `POST /sessions/{id}/query` `{sql, connection?: "a"|"b"}`, `GET /sessions/{id}/locks`, `DELETE /sessions/{id}`.

Build: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o sqllens-agent .`

Triển khai (Task037): `/opt/sqllens` và mọi file `session.sh`, `my.cnf` phải thuộc root và không ai khác ghi được, vì agent chạy root và gọi `session.sh`. Cài bằng `install -o root -g root`, rồi `chown -R root:root /opt/sqllens`. Tổng `--memory` của các phiên cộng phần máy dùng (khoảng 230 MiB) phải nhỏ hơn RAM máy, nếu không SQL người dùng làm nóng RAM chung.

## Cổng HTTPS và chủ phiên (Task074)

- Cổng loopback `AGENT_ADDR` giữ nguyên (dùng cho SSH tunnel và kiểm tại máy). Thêm cổng HTTPS khi đặt `AGENT_TLS_ADDR` (ví dụ `0.0.0.0:8443`), cùng handler và cùng token. Để trống thì không mở cổng HTTPS.
- Chứng chỉ tự ký ECDSA P-256, hạn 3 năm, ở `TLS_DIR` (/etc/sqllens-agent): `tls.key` quyền 600, `tls.crt`. Agent không tự sinh (service chỉ đọc /etc). Tạo bằng `sudo /opt/sqllens/sqllens-agent cert` (in vân tay SHA-256), đọc lại bằng `... fingerprint`, đổi bằng `... cert -rotate` rồi cập nhật vân tay trên Render.
- Mọi route `/sessions*` cần header `X-Sandbox-User` (user id, tối đa 128 byte). Agent lưu SHA-256 của nó làm chủ phiên. Người khác gọi vào phiên không phải của mình nhận 404 `session_not_found` y hệt id lạ. Mỗi chủ tối đa `MAX_PER_OWNER` (1) phiên; vượt thì 429 `user_session_limit`.
