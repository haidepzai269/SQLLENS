# Spike Task159 — Live Rooms

Thư mục tự chứa, không nối vào sản phẩm. Mục đích duy nhất: đo byte và tải cho quyết định
go/no-go của Epic SP024 "Live Rooms".

Đọc `_bmad-output/SP024/STR108/Task159/ket_qua_do.md` để xem số đo.

## Thành phần

| Thư mục | Việc |
|---|---|
| `server/` | Gin fan-out: publish, poll (ETag/304), SSE, `/metrics`. Không auth, không DB, không log SQL. |
| `web/` | Next 16.4.4 App Router. Trang đo `/ac1`, `/ac3`, `/host`, `/viewer`. |

## Chạy

```powershell
# 1) server
cd server
go vet ./... ; go build -o liverooms.exe .
$env:ADDR=":18160"; .\liverooms.exe

# 2) web (bản build, KHÔNG dùng next dev)
cd ../web
npm install
npm run build
$env:API_ORIGIN="http://localhost:18160"
npm run start -- -p 3159

# 3) đo
node tools/ac1.mjs
node tools/ac3.mjs
node tools/ac4.mjs
```

`next dev` cho số sai, không dùng.

## Điều không làm

- Không sửa `web/src/`, `api/internal/`, `web/messages/`.
- Không thêm dependency vào `web/package.json` hay `api/go.mod`.
- Không gọi Neon, Upstash, Render, Cloudflare. Mọi thứ chạy localhost.
- Không gửi SQL ra ngoài máy. Server không đọc nội dung payload.
- `codec.ts`, `snapshot.ts`, `btree-read.ts`, `btree-key.ts`, `normalize/postgres.ts`,
  `contracts/*.ts` là bản sao nguyên văn từ `web/src/`; bảng SHA256 đối chiếu nằm ở mục
  cuối `_bmad-output/SP024/STR108/Task159/ket_qua_do.md`. Sửa bản gốc thì phải chép lại,
  không sửa tay ở đây.
