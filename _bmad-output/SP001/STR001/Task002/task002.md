# Task002: Khung api

Thuộc: SP001 / STR001
Mục tiêu: Tạo server Gin trong `api/` có healthcheck, test, và tắt an toàn khi nhận tín hiệu.
Phạm vi: `api/**`. Không sửa file ngoài `api/`.
Không làm: Dockerfile, định dạng lỗi, middleware log, auth, kết nối Neon hay Upstash. Các việc này thuộc Task009 và SP005.

Hợp đồng:
- Module: `github.com/haidepzai269/SQLLENS/api`, Go 1.25.
- `api/cmd/server/main.go`: đọc cổng từ biến `PORT`, mặc định `8080`.
- `api/internal/httpapi/router.go`: hàm `NewRouter() *gin.Engine`, dùng được trong test mà không mở cổng.
- `GET /healthz` trả 200 với JSON `{"status":"ok"}`. Route này không được chạm vào dịch vụ ngoài, vì lệnh ping giữ thức sẽ gọi nó.

Tiêu chí xong:
- AC1: `go test ./...` thoát với mã 0, có test cho `GET /healthz` kiểm tra mã 200 và body.
- AC2: `gofmt -l .` không in file nào, `go vet ./...` thoát với mã 0.
- AC3: `go build ./cmd/server` thành công.
- AC4: Chạy server với `PORT=18080`, `curl localhost:18080/healthz` trả 200.
- AC5: Khi nhận SIGINT hoặc SIGTERM, server chờ request đang chạy tối đa 10 giây rồi thoát, không kill ngay.
- AC6: Gin chạy ở release mode trừ khi đặt `GIN_MODE`.

Ca biên:
- `PORT` sai định dạng: server thoát với thông báo lỗi rõ, không chạy ở cổng khác.
- Trên Windows không có SIGTERM thật: AC5 kiểm bằng test hoặc trong Docker, ghi rõ cách đã kiểm vào bàn giao.

Kiểm tra: `cd api && gofmt -l . && go vet ./... && go test ./... && go build ./cmd/server`
Góc review thêm: không có.
Đọc thêm: `CLAUDE.md` mục "Kiến trúc".
