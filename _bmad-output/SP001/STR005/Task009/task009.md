# Task009: Gin an toàn và Docker

Thuộc: SP001 / STR005
Mục tiêu: Gin có định dạng lỗi thống nhất, log không bao giờ chứa SQL người dùng, và đóng gói được thành Docker image.
Phạm vi: `api/**`.
Không làm: auth, quota, AI proxy, deploy lên Render (Task010).

Hợp đồng:
- Mọi lỗi trả JSON `{"error":{"code":"...","messageKey":"..."}}`, gồm cả 404, 405 và panic. Không trả stack trace hay nội dung request.
- Log request chỉ gồm method, route đã khớp mẫu, status, thời gian xử lý. Không ghi query string, body, hay header `Authorization` và `Cookie`.
- Panic được bắt, log không chứa request dump, trả 500 theo định dạng lỗi.
- Giới hạn body mặc định 1 MB, vượt thì trả 413 theo định dạng lỗi.
- `SetTrustedProxies(nil)`, trừ khi có cấu hình rõ ràng về sau.
- `api/Dockerfile` build nhiều tầng, image cuối chạy bằng user không phải root. Có `api/.dockerignore`.

Tiêu chí xong:
- AC1: Test gửi request có SQL trong body và query string kèm chuỗi đánh dấu, rồi xác nhận chuỗi đó không có trong log đã bắt.
- AC2: Test route gây panic có SQL trong body: trả 500 đúng định dạng, log và response không chứa chuỗi đánh dấu.
- AC3: `GET /khong-co`: 404 đúng định dạng. `POST /healthz`: 405 đúng định dạng.
- AC4: Body 2 MB: 413 đúng định dạng.
- AC5: `docker build -t sqllens-api api` thành công. `docker run` với `PORT=18080`, `curl /healthz` trả 200.
- AC6: `docker run --rm --entrypoint id sqllens-api` không phải `uid=0`, hoặc nếu image không có `id` thì `docker inspect` cho thấy `User` không phải root.
- AC7: `gofmt`, `go vet`, `go test ./...` đều sạch.

- AC8: Gửi SIGTERM vào container đang chạy: server tắt an toàn và thoát mã 0. Task002 chưa kiểm được việc này trên Windows.
- AC9: `api/.gitignore` chặn file `server` và `server.exe` do `go build ./cmd/server` tạo ra.

Ca biên: route không khớp mẫu thì log ghi là không khớp, không ghi đường dẫn thô, vì đường dẫn có thể chứa dữ liệu người dùng.
Kiểm tra: `cd api && go vet ./... && go test ./... && docker build -t sqllens-api .`
Góc review thêm: bảo mật.
Đọc thêm: `CLAUDE.md` nguyên tắc 7, 8; `web/src/contracts/api-error.ts` nếu Task008 đã merge; bàn giao Task002.
