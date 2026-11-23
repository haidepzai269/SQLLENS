# STR114 — Đồng biên tập Yjs & Điều phối The Baton

> Epic: SP024 | Trạng thái: **Chờ duyệt task**
> Điều kiện vào: **Task162 xong** (cần phòng), **và** bản sửa rewrite `/api` đã vào `main`
> Thứ tự: **Tầng 3 (STR116) chạy trước.** Story này chỉ mở sau khi Task170 xong.

## Mục tiêu

Các Editor cùng sửa `.sql` thời gian thực qua Yjs CRDT. Nút Run có trạng thái. Cơ chế "The Baton" cho phép luân chuyển quyền chạy engine. SQL không rời máy người cầm Baton — kết quả truyền P2P qua WebRTC DataChannel, không qua Gin.

## Kiến trúc cốt lõi

```
Gin signaling (/signal WebSocket)  ← chỉ SDP/ICE, 0 byte SQL
Yjs P2P WebRTC Provider           ← CRDT sync văn bản
WebRTC DataChannel                 ← kết quả PGlite P2P sau Baton grant
Baton REST API (/baton/request, /baton/grant, /baton/heartbeat) ← state trên Gin RAM
```

> **Đã đo 2026-11-23:** WebSocket qua `rewrites` của Next.js 16.4.4 chạy được. Mở sau **15 ms** qua Next so với **11 ms** gọi thẳng Gin; có header `Origin` vẫn mở được (12 ms). Chênh ~4 ms. Kiến trúc P2P + Gin signaling giữ nguyên, không phải đổi. **Chưa đo trên Vercel thật** — Task163 phải kiểm lại trên bản deploy, vì Vercel giới hạn thời lượng hàm và không cam kết WebSocket cho mọi gói.

> **Bẫy đường dẫn:** `web/next.config.ts` có hai rule rewrite. Rule chung `source: "/api/:path*"` → `${apiOrigin()}/:path*` **cắt tiền tố `/api`**. Đo thật: trình duyệt gọi `/api/v1/cloud/projects/abc/signal`, Gin nhận `/v1/cloud/projects/abc/signal`. Có rule hẹp riêng cho tiền tố `/api/v1/cloud/` đứng trước để giữ nguyên `/api`. Task163 phải kiểm `r.Routes()` đối chiếu với `web/next.config.ts` trước khi kết luận route đúng.

> **Cấm `y-websocket` làm dự phòng.** Nó đẩy toàn bộ văn bản `.sql` qua Gin — trái quyết định Zero-Log Transit. Phương án dự phòng duy nhất được phép là `y-webrtc`.

## Giao diện có

Có

## Nhãn

**Chưa đo.**

## Task

| Task | Mô tả | Trạng thái |
|---|---|---|
| Task163 | Gin WebSocket signaling `/signal` (không thêm dep frontend, không có 3 Baton API — xem `Task163/task163.md` D1/D2) | Chờ |
| Task164 | Yjs Provider + CodeMirror 6 binding (thêm `zustand` thành direct dep) | Chờ |
| Task165 | UI The Baton: nút Play trong `lab-workspace.tsx:748-759`, toast xin quyền, i18n | Chờ |
| Task166 | WebRTC DataChannel broadcast kết quả P2P + NAT warning | Chờ |

> **Sửa tên component:** không có `<RunButton />` trong `web/src`. Nút chạy thật là `<Button>` inline ở `web/src/modules/lab/lab-workspace.tsx:749-758`.

## Tiêu chí nghiệm thu Story

- AC1: 2 Editor sync trong < 200 ms (4 trình duyệt: 2 editor + 2 viewer cùng lúc)
- AC2: Nút Run disabled với tooltip chứa **tên người đang giữ Baton** lấy từ baton-store, không hardcode tên
- AC3: Request → Grant → Baton chuyển mượt mà
- AC4: Kết quả P2P trong < 1 s
- AC5: Gin log **0 byte SQL**; **0 byte SQL vào Neon**
- AC6: Mất kết nối 30 s → Baton auto-return host
- AC7: Viewer không có nút Run, không có nút Xin quyền

## Cảnh báo WebRTC

Symmetric NAT sẽ làm DataChannel không kết nối được. Phạm vi V1: không làm TURN server tốn phí. Ghi rõ hạn chế này trong UI: "Tính năng hoạt động tốt nhất trên cùng mạng hoặc Open NAT."
