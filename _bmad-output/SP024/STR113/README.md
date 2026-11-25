# STR113 — Quản lý phòng & vai trò Editor

> Epic: SP024 | Trạng thái: **Chờ duyệt task**
> Điều kiện vào: SP023 xong, chủ dự án duyệt `BAN_NHAP_STORY_SP024.md` bản v3
> Thứ tự: **Tầng 3 (STR116) chạy trước.** Story này chỉ mở sau khi Task170 xong.

## Mục tiêu

Host tạo phòng cộng tác, mời người bằng link token có hạn, cấp/thu hồi vai trò `editor`/`viewer` cho từng người. Phân quyền kiểm ở Gin + RLS Neon (kế thừa SP023), không tin client.

Phòng **là** một cloud project (quyết định C1, Đường B). Không có bảng `live_rooms`; schema mở rộng `cloud_project_members` và thêm hai bảng `room_invite_tokens`, `room_baton` ở migration 006. Người chưa đăng nhập không vào phòng được.

## Giao diện có

Có (UI: `InviteDialog`, `RoomMemberList`, nút "Mời cộng tác" trong toolbar của `stage.tsx:559-562`)

## Nhãn

**Chưa đo.** Không được ghi "Thật" cho tới khi có số đo thật trên bản deploy. Ghi "Thật" ở đây là tự tuyên bố một điều chưa ai kiểm.

## Task

| Task | Mô tả | Trạng thái |
|---|---|---|
| Task160 | Migration **006**: `room_invite_tokens` + `room_baton`, RLS 6 policy + `GRANT` cho `sqllens_app` | **Đã merge** (`84083ef`), 6 lỗi đang sửa ở `SP999/STR117/Task171` |
| Task161 | Gin API: invite, join, thu hồi thành viên, GET baton, baton/claim, arena-step (**6 endpoint**) | **Xong 100%** — Reviewer độc lập nghiệm thu PASS 100% (5/5 AC, 9 ca biên, 8/8 package ok). Đã merge vào `main`. Xem `STR116/Task161/ban_giao_task161.md` |
| Task162 | UI: `InviteDialog`, `JoinRoomPage` tại `[locale]/join`, nút "Mời" vào `stage.tsx` | **Code xong, CHƯA merge** — kèm sai lệch D1: thêm `GET /:id/members` (Task161 chưa có endpoint đọc thành viên nên AC2 bất khả thi). Review 24/11: 21 phát hiện đã sửa. **Review vòng 2: thêm 8 phát hiện, đã sửa hết 25/11** (chủ phòng hiện trùng trong danh sách, vé hết hạn chặn tạo link mới, màn “đã tham gia” cụt đường, hộp thoại mời nhầm dự án đầu tiên, AC5 kiểm cả 3 endpoint, +3 test còn thiếu). 1514 test web PASS, `next build` PASS, 6/6 E2E Chromium, 8/8 package Go — xem mục “Vòng sửa 2” trong `Task162/ban_giao_task162.md`. **Chờ reviewer độc lập vòng 3.** |

> Task160 và Task161 thuộc STR116 (Tầng 3) về mặt thi công thứ tự, nhưng schema và API phòng là của STR113. Xem bảng F trong `BAN_NHAP_STORY_SP024.md` để biết thứ tự chạy thật.

## Tiêu chí nghiệm thu Story

- AC1: Tạo phòng = tạo cloud project, nhận id UUID; `cloud_project_members` có dòng `owner` cho người tạo
- AC2: Invite token 24h, hết hạn trả 410 `token_expired`
- AC3: Thu hồi quyền → 403 tức thì; người bị thu hồi gọi `GET /projects/:id` nhận 404
- AC4: Redirect đăng nhập + quay lại phòng (route phải nằm trong `[locale]`)
- AC5: RLS cross-tenant chạy thật với role `sqllens_app` — và phải chứng minh test **không** xanh giả vì `permission denied`. Xem khối `DO $$` ở Task160.
- AC6: Gin chỉ log `%T` của lỗi, **0 byte SQL** trong log
- AC7: Đăng ký route xong gọi `r.Routes()` — không panic trùng handler, đủ 6 đường dẫn
