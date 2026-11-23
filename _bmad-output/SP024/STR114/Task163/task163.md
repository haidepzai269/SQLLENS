# Task163 — Gin WebSocket signaling `/signal` (Tầng 2, STR114)

Thuộc: SP024 / STR114
Mục tiêu: một endpoint WebSocket để hai trình duyệt trong cùng phòng trao đổi SDP/ICE, làm signaling cho WebRTC DataChannel P2P. **Chỉ SDP/ICE đi qua Gin — 0 byte SQL.**
Phạm vi: `api/internal/httpapi/room_signal.go` (mới), `api/internal/httpapi/room_signal_test.go` (mới), `api/cmd/server/main.go` (thêm đúng một dòng mount), `api/go.mod` + `api/go.sum` (một dòng `require`).
Không làm: không đăng ký lại `GET /baton` (Task161 sở hữu), không đụng `web/`, không thêm dependency frontend, không sửa `web/next.config.ts`.

**Dependency Go — phiên chính đã chốt phiên bản, Amelia tự thêm:** chạy `cd api; go get github.com/coder/websocket@v1.8.15` **sau khi** file `room_signal.go` đã dùng nó, rồi `go mod tidy`. Phiên chính đã đo là `go get` lấy được bản này và `go build ./...` sạch, nhưng **không** commit sẵn vào `go.mod` vì `go mod tidy` sẽ xoá ngay một `require` chưa ai import — để lại `go.mod` có dòng thừa là tự tạo nợ. Dùng đúng `v1.8.15`, không `@latest`.


## Hai sai lệch so với bản nháp v3 — bắt buộc reviewer đọc

**D1 — Ba endpoint Baton **rời khỏi** Task163, chuyển sang Task161.** Bản nháp v3 để Task163 làm `POST /baton/request`, `/baton/grant`, `/baton/heartbeat` với state **trong RAM Gin** (Sửa #16), trong khi Task161 đọc `GET /baton` từ **bảng `room_baton`** đã có ở migration 006. Hai nguồn sự thật cho cùng một trạng thái: Gin restart thì RAM về `null` còn bảng vẫn giữ `holder_id` cũ, nên `GET /baton` trả người giữ gậy đã mất quyền. Bảng đã merge và đã có RLS, nên **bảng là nguồn sự thật duy nhất**; cả 4 thao tác Baton nằm ở Task161, dùng chung một store và một file handler. Hệ quả: AC1 của bản nháp (`TestBatonLifecycle`) thuộc Task161; Task163 chỉ còn signaling. Đổi này cũng làm hai task không còn sửa cùng file, nên chạy song song được.

**D2 — Không thêm dependency frontend ở task này.** Bản nháp để Task163 thêm `yjs`, `y-codemirror.next`, `lib0`, `y-webrtc` vào `web/package.json`. Task163 không có dòng TypeScript nào, nên thêm bây giờ là thêm dependency không ai dùng. `yjs` + `y-codemirror.next` + `lib0` thuộc Task164; `y-webrtc` thuộc Task166. Ghi vào bàn giao để hai task đó nhớ.

## Hợp đồng endpoint

```
GET /api/v1/cloud/projects/:id/signal   (WebSocket upgrade, cần đăng nhập)
```

- Chỉ thành viên phòng (hoặc owner) được mở. Người ngoài: **401** khi chưa đăng nhập, **404** khi đã đăng nhập nhưng không có quyền — không lộ dự án có tồn tại.
- Sau khi nâng cấp, server giữ kết nối và chuyển tiếp message cho **các peer khác trong cùng `:id`**. Không lưu, không ghi log nội dung.
- Message là JSON tự do có trường `to` (tuỳ chọn). Có `to` thì chỉ gửi cho peer đó; không có thì phát cho mọi peer khác trong phòng. Server **không** diễn giải SDP/ICE, chỉ chuyển tiếp.
- Trần một message: **64 KB**. Vượt thì đóng kết nối mã `1009`.
- JSON hỏng: đóng kết nối mã `1007`, không làm sập hub.

## Kiến trúc

```text
map[projectID]map[*peer]struct{}   // bảo vệ bằng một sync.Mutex
peer{conn *websocket.Conn, send chan []byte}
```

Mỗi peer có một goroutine ghi (đọc từ `send`) để nhiều goroutine không cùng ghi một `*websocket.Conn`. Peer rời (đọc lỗi, hoặc context huỷ) thì **phải** bị xoá khỏi map, kể cả khi phòng trống — nếu không, bộ nhớ Gin phình theo số lần vào/ra phòng.

**Ghi trong code comment đúng câu này** (Sửa #16 vẫn còn giá trị cho phần state phòng): `// Signaling state is ephemeral; resets on server restart. Peers re-dial on reconnect.`

## Tiêu chí xong

- AC1: `TestRoomSignalHandshake` — dựng `httptest.NewServer` với route thật, dial bằng `websocket.Dial`, khẳng định handshake **101 Switching Protocols**, gửi một message và nhận lại đúng nội dung. Test **phải** fail nếu ai đó thay bằng `go build` (không có assertion nào về việc biên dịch được).
- AC2: `TestRoomSignalRelay` — ba peer: A, B cùng phòng, C phòng khác. A gửi `{"type":"offer","sdp":"..."}` → **B nhận**, **C không nhận** (kiểm bằng hạn chờ, không phải bằng "không thấy lỗi").
- AC3: `TestRoomSignalRequiresAuth` — không có cookie phiên: nâng cấp bị từ chối **401**, không có 101. Người đã đăng nhập nhưng không phải thành viên: **404**.
- AC4: `TestRoomSignalZeroSQLInLog` — bật log buffer của Gin, cho một peer gửi message có nội dung giống SQL (`SELECT * FROM users`), khẳng định buffer log **không chứa** chuỗi đó. Đây là AC của Nguyên tắc 7, không phải AC hình thức.
- AC5: `TestRoomSignalRoutes` — gọi `r.Routes()`, khẳng định đúng **một** route `/api/v1/cloud/projects/:id/signal`, không panic trùng handler, và đường dẫn khớp rule rewrite hẹp `/api/v1/cloud/:path*` trong `web/next.config.ts` (đọc file bằng test, đừng chép tay chuỗi).
- AC6: `TestRoomSignalPeerCleanup` — peer ngắt kết nối thì bị xoá khỏi hub (đọc kích thước map qua hàm nội bộ, không đoán). Chạy `go test -race -run RoomSignal ./internal/httpapi` PASS.
- AC7: `go build ./...` PASS; `go vet ./...` PASS; `go test -p 1 ./... -count=1` PASS toàn bộ package.

## Ca biên

- Hai peer mở cùng lúc trong cùng phòng: cả hai nhận được message của nhau.
- Peer thứ hai vào sau khi peer thứ nhất đã gửi: không nhận lại message cũ (server không đệm lịch sử).
- Message 65 KB: bị đóng `1009`, các peer khác trong phòng **vẫn sống**.
- JSON hỏng: bị đóng `1007`, hub không panic, peer khác vẫn sống.
- Message có `to` trỏ peer không tồn tại: bỏ qua, không lỗi.
- Đóng kết nối đúng cách (client close) không làm rò goroutine: `goleak` không có trong repo nên kiểm bằng cách đếm peer trong map.

## Kiểm tra

```powershell
$env:RLS_TEST_DSN="postgres://postgres:t152@localhost:54492/app163"
$env:T149_DATABASE_URL=$env:RLS_TEST_DSN
cd api
go build ./...
go vet ./...
go test -p 1 ./... -count=1
go test -race -run RoomSignal ./internal/httpapi
```

Container `t160-pg` (PostgreSQL 18, cổng 54492, mật khẩu `t152`). Database `app163` đã dựng sẵn và trống. Dùng `app163`, **không** dùng `app` (Task171 và Task161 chạy trên database khác).

## Góc review thêm

- Bảo mật: đây là đường mở socket giữ kết nối lâu trên Render free. Reviewer phải kiểm: có giới hạn số peer mỗi phòng, có hạn thời gian sống, và không có đường nào để message của phòng A tới phòng B.
- Nguyên tắc 7: AC4 là AC bắt buộc, không được hạ thành "đọc code thấy không log".
- Đường dẫn: rule rewrite hẹp `/api/v1/cloud/:path*` **đã có** trên `main` (`web/next.config.ts`), nhưng **chưa đo trên bản deploy Vercel thật**. Không được ghi "Thật" cho phần deploy; ghi "Chưa đo".

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task163 (dòng 359–390)
- `_bmad-output/SP024/STR114/README.md`
- `api/internal/httpapi/cloud_projects.go:64-87` (khuôn `MountCloud` + guard)
- `api/internal/httpapi/cloud_projects.go` (`Abort` cho mã lỗi thống nhất)
