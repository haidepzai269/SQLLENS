# Bàn giao Task002

Đã làm: Server Gin trong `api/` với `GET /healthz` trả 200 và `{"status":"ok"}`, đọc `PORT` (mặc định 8080, sai định dạng thì thoát mã 1 kèm thông báo), chạy release mode trừ khi đặt `GIN_MODE`, và tắt an toàn khi nhận SIGINT hoặc SIGTERM (chờ request đang chạy tối đa 10 giây).
File chính: `api/cmd/server/main.go`, `api/internal/httpapi/router.go`, `api/internal/httpapi/server.go`, `api/.gitattributes`.
Kết quả kiểm tra: `gofmt -l .` không in gì; `go vet ./...` sạch; `go test -count=1 ./...` đạt cả hai package; `go build ./cmd/server` thành công. Chạy thật với `PORT=18080`, `curl localhost:18080/healthz` trả 200 và đúng body. `PORT=abc` in `invalid PORT "abc": want an integer 1-65535` và thoát mã 1.
Cách kiểm AC5: Windows không có SIGTERM thật, nên kiểm bằng `TestServeGracefulShutdown`: hủy context khi một request đang chạy, request vẫn nhận đủ phản hồi rồi `Serve` mới thoát. Phần nối `signal.NotifyContext` trong `main.go` chưa được gửi tín hiệu thật vào tiến trình, và chưa kiểm trong Docker.
Kết quả review: 0 lỗi confirmed. 2 lưu ý needs_validation đều đã sửa: `PORT=080` và `+80` giờ bị từ chối; test release mode khôi phục gin mode sau khi chạy.
Chưa làm được: Kiểm SIGTERM thật trong Docker.
Phát sinh: Thêm `api/.gitattributes` (`*.go text eol=lf`) vì git trên Windows đổi file sang CRLF, còn CI chạy gofmt trên Linux. `go.mod` và `go.sum` cũng bị cảnh báo CRLF, nên có thể thêm `go.mod text eol=lf` nếu CI đổi ý. Module ghi `go 1.25.0` do `go get` tự nâng.
Việc tiếp theo cần biết: `go build ./cmd/server` không có `-o` sẽ để file `server.exe` trong `api/`, nên Task009 hãy thêm nó vào `.gitignore` khi viết Dockerfile. `httpapi.Serve(ctx, ln, handler, timeout)` nhận listener có sẵn nên test không cần cổng cố định.
