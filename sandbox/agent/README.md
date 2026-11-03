# sandbox/agent

Dịch vụ Go chạy trên máy Azure: tạo, chạy SQL, hủy phiên MySQL qua HTTP. Chỉ nghe `127.0.0.1` (từ chối địa chỉ khác lúc khởi động). Xem `_bmad-output/SP004/STR016/Task035/`.

Môi trường: `AGENT_ADDR` (127.0.0.1:8081), `TOKEN_FILE` (/etc/sqllens-agent/token, quyền 600, ít nhất 32 ký tự), `SESSION_SH`, `SESS_ROOT`, `MAX_SESSIONS` (2), `IDLE_TTL_SEC` (900), `QUERY_TIMEOUT_SEC` (15), `DISK_LIMIT_MB` (512).

API (Bearer token, trừ `/healthz`): `POST /sessions`, `POST /sessions/{id}/query` `{sql, connection?: "a"|"b"}`, `GET /sessions/{id}/locks`, `DELETE /sessions/{id}`.

Build: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o sqllens-agent .`
