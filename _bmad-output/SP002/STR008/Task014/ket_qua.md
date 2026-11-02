# Kết quả Task014: cookie và stream qua rewrites

Máy: Windows, Node 22.15, Go 1.25.5, Next 16.4.4, Gin 1.12.0, Chromium của Playwright. Chạy `next start` bản build.

## Lệnh đã chạy

```
cd spikes/stream-cookie/server && ADDR=:18140 go run .        # hoặc go build rồi chạy
cd spikes/stream-cookie/web && npm ci && npm run build && npm run check
```

`npm run check` (Playwright) khởi động `next start -p 3140` rồi gọi qua `/api/*`. Server Go phải chạy trước ở `:18140` (đổi bằng biến `API_ORIGIN` khi build).

## AC1: đạt (trên máy)

Sau `/api/login`, `/api/me` trả `sid=spike-session`. Cookie trong trình duyệt:
`{"name":"sid","domain":"localhost","path":"/","httpOnly":true,"secure":false,"sameSite":"Lax"}`.
Cookie không có thuộc tính Domain (kiểm trên header Set-Cookie thật), nên gắn vào host của trang gọi, tức Next. Cổng không nằm trong cookie, nên trường domain `localhost` một mình không phân biệt Next với Go; bằng chứng là Go không đặt Domain và trang chỉ gọi qua `/api`. `document.cookie` không thấy `sid` (HttpOnly). `secure:false` vì chạy http; Go đặt `Secure` khi `COOKIE_SECURE=1`, chưa chạy thử với HTTPS.

## AC2: đạt, với điều kiện tắt nén

Mặc định `next start` bật `compress` (gzip) và gom cả stream: trình duyệt nhận 1 phần duy nhất, khoảng cách 0 ms. Đo bằng curl có `Accept-Encoding: gzip`: gần như toàn bộ dữ liệu đến sau khoảng 3,2 giây (reviewer thấy một mẩu nhỏ đến sớm ở 345 ms), tức bị giữ đến hết.
Với `compress: false` trong `next.config.ts`: trình duyệt nhận 10 phần, khoảng cách đầu đến cuối 2711 ms (test yêu cầu lớn hơn 2000 ms). Đi trực tiếp tới Go thì khoảng 2,4 giây, nên rewrites thêm khoảng 0,3 giây trễ, không gom.

## AC3: header không ảnh hưởng, nén mới là nguyên nhân

Đo thời gian từ lúc gọi đến phần đầu và phần cuối, qua rewrites, curl, `compress: false`:

| Header Go gửi | Phần đầu | Phần cuối |
|---|---|---|
| đủ ba header | 567 ms | 3263 ms |
| không có header nào, Content-Type `text/plain` | 478 ms | 3147 ms |
| bỏ `Cache-Control` | 580 ms | 4456 ms (nhiễu, lần đo đơn) |
| bỏ `X-Accel-Buffering` | 531 ms | 3140 ms |
| bỏ `Content-Type: text/event-stream` | 468 ms | 3141 ms |

Với `compress: true` thì có đủ hay không có header đều bị gom (phần đầu 3263 ms và 3234 ms). Kết luận: chỉ cần `compress: false`. Giữ ba header vì rẻ và cần khi có nginx hoặc CDN phía trước. `X-Accel-Buffering` chỉ có tác dụng với nginx, chưa kiểm. Mỗi ô chỉ đo một lần.

## AC4: chưa kiểm trên Vercel

Task010 chưa có trên `main`, chưa có tài khoản Vercel hay Render được cấp. Các bước chạy lại sau:
1. Tạo project Vercel riêng, root `spikes/stream-cookie/web`. Đặt biến `API_ORIGIN` thành URL Render (https, không có dấu `/` cuối).
2. Tạo dịch vụ Render riêng chạy server Go (spike chưa có Dockerfile, phải thêm trước, hoặc dùng runtime Go gốc của Render), `ADDR=:$PORT`, `COOKIE_SECURE=1`.
3. Mở trang spike trên domain Vercel, bấm Chạy, đọc kết quả. Kiểm: cookie `sid` có `Secure`, domain là domain Vercel; `/api/me` có cookie; khoảng cách phần đầu đến phần cuối lớn hơn 2 giây.
4. Với Vercel: rewrites ngoài tới Render có thể bị CDN gom hoặc cắt theo hạn thời gian. Nếu gom, thử Route Handler proxy (xem phần ca biên) và ghi so sánh.
5. Render free ngủ khi không có request: lần gọi đầu có thể chậm hàng chục giây, không tính vào khoảng cách phần.

## Ca biên: Route Handler proxy

Không cần thử: rewrites chạy được sau khi tắt `compress`. Chưa so sánh. Nếu Vercel gom thì làm bước 4.

## Cấu hình đưa vào `web/` và `api/`

`web/next.config.ts`:
```ts
compress: false, // (spike đọc NEXT_COMPRESS=1 để bật lại khi đo) nếu tự host bằng next start. Trên Vercel nén do nền tảng làm, chưa kiểm
rewrites: async () => [{ source: "/api/:path*", destination: `${process.env.API_ORIGIN}/:path*` }],
```
`api/` khi gửi SSE: đặt `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, gọi `Flush()` sau header và sau mỗi phần, và dừng khi `c.Request.Context().Done()`.
Cookie đăng nhập: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` khi HTTPS, không đặt `Domain` để cookie gắn vào host mà trình duyệt đang dùng (domain của Next).

## Ghi chú bảo mật cookie

- Rewrites chuyển nguyên header `Cookie` của trình duyệt sang Go, gồm mọi cookie của domain Next. Đặt tên cookie rõ ràng và Gin chỉ đọc `sid`.
- Cookie `SameSite=Lax` vẫn được gửi khi điều hướng GET từ trang khác. Route đổi trạng thái phải là POST và Gin cần kiểm `Origin` (CSRF). Spike dùng GET `/login` chỉ để thử.
- Cần cho SP005: `Secure` chưa kiểm trên HTTPS thật; `/me` trong spike trả giá trị cookie, bản thật không được làm vậy.
