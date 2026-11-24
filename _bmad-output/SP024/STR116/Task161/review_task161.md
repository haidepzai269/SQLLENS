# Biên bản Review độc lập — Task161: Gin API phòng & Migration 007

**Người review:** `task-reviewer` độc lập (phiên DeepSeek Harness + Hội đồng BMAD)  
**Ngày review:** 2026-11-24  
**Worktree:** `C:\SQLLens\.worktrees\Task161`, nhánh `task/Task161`, commit `d9cd5c9` (`feat(Task161): thêm sáu endpoint phòng cộng tác`)  
**Kết luận:** **PASS 100% — ĐỦ ĐIỀU KIỆN MERGE VÀO MAIN**

---

## 1. Kết quả kiểm tra Tiêu chí nghiệm thu (AC1–AC5)

| AC | Tiêu chí | Kết quả thực nghiệm | Đánh giá |
|---|---|---|---|
| **AC1** | `POST /invite` → token 24 h; `POST /join` với token hết hạn → **410 `token_expired`** | `TestRoomInviteAndJoin` pass (0.72s): invite sinh token 24h, join trả `{projectId, role: 'editor', alreadyMember: false}`. `TestRoomJoinBadToken` pass (0.64s): token hết hạn trả 410 `token_expired`. | **PASS** |
| **AC2** | `DELETE /members/:uid` → **403** khi không phải owner; thành viên bị xóa gọi `GET /projects/:id` → **404** | `TestRoomRemoveMember` pass (0.76s): người ngoài xóa trả 403; owner xóa trả 204; thành viên sau khi xóa gọi `GET /projects/:id` nhận 404 (chặn cả ở tầng SQL và tầng RLS). | **PASS** |
| **AC3** | Gin chỉ log `%T` của lỗi, **0 byte SQL** và 0 byte token trong log (Zero-Log Transit) | `TestRoomLogsNoTokenOrSQL` pass (0.58s): đọc buffer log thật của Gin, ép nhánh lỗi 500/400/404, log chỉ ghi `%T` (`*fmt.wrapError`), 0 byte SQL, 0 byte token thô. | **PASS** |
| **AC4** | `go test -p 1 ./internal/httpapi/...` có **≥ 6 test case, mỗi endpoint một case** | Đạt **9 test case** bao phủ toàn bộ 6 endpoint (`TestRoomInviteAndJoin`, `TestRoomJoinBadToken`, `TestRoomJoinSecondTimeAndTokenIsolation`, `TestRoomRemoveMember`, `TestRoomBaton`, `TestRoomArenaStep`, `TestRoomLogsNoTokenOrSQL`, `TestRoomRoutesRegistered`, `TestRoomStoreIsWired`), chạy mất 17.767s ok. | **PASS** |
| **AC5** | Gọi `r.Routes()`, khẳng định **không panic trùng handler** và liệt kê đủ 6 đường dẫn | `TestRoomRoutesRegistered` pass (0.57s): gọi `r.Routes()`, kiểm tra static `/join` không xung đột wildcard param `/:id`, đủ 6 đường dẫn. | **PASS** |

---

## 2. Kiểm tra 9 Ca biên (Edge Cases)

1. **Token sai / không tồn tại:** Trả `400` với mã `bad_request` (`token_not_found`). (PASS)
2. **Token hết hạn:** Trả `410` với mã `token_expired` (không nhầm sang 404). (PASS)
3. **Người ngoài join bằng token dự án khác:** Vào đúng dự án của token đó nhưng không xem được token của dự án khác. (PASS)
4. **Join lần hai (Idempotent):** Trả `alreadyMember: true`, không tạo dòng trùng lặp trong DB. (PASS)
5. **Owner tự xóa chính mình:** Trả `400` `cannot_remove_owner`. (PASS)
6. **Xóa thành viên không tồn tại:** Trả `404` `member_not_found`. (PASS)
7. **Step âm hoặc phi số:** Trả `400` `invalid_step`. (PASS)
8. **Thành viên gọi `POST /arena-step`:** Trả `403` `forbidden` (chỉ owner mới được tiến bước). (PASS)
9. **Dự án người khác khi chưa join:** `GET /projects/:id` trả `404`, không lộ dự án có tồn tại. (PASS)

---

## 3. RLS & Phép thử đột biến (Mutation Testing M1–M7)

Đã chạy trên PostgreSQL 18 cluster `t161-pg` / database `app161` với role non-superuser `sqllens_app`:
- **Inventory catalog:** Có đúng 20 policy trong schema `public` (13 cloud tables + 7 room tables). Cả 5 bảng `cloud_projects`, `cloud_tabs`, `cloud_project_members`, `room_invite_tokens`, `room_baton` đều `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- **Cột `arena_step`:** Kiểu `integer NOT NULL DEFAULT 0` trong `room_baton`.
- **Idempotency Migration 007:** Chạy lại file `007_room_api.sql` hai lần trên database sạch: số policy giữ nguyên `20 -> 20 -> 20`, không duplicate policy.
- **7 Đột biến (M1–M7):**
  - M1 (Bỏ `WithInvite` GUC setting): Test `TestRoomInviteJoinUnderRLS` FAIL.
  - M2 (Đổi policy `cloud_projects_select_invite` sai điều kiện): Test FAIL.
  - M3 (Rò rỉ GUC sang request sau): Test `TestRoomInviteContextDiesWithTransaction` FAIL.
  - M4 (Bỏ kiểm tra owner ở `RemoveMember`): Test `TestRoomRemoveMember` FAIL.
  - M5 (Bỏ validate `step >= 0`): Test `TestRoomArenaStep/step_âm` FAIL.
  - M6 (Bỏ transaction ở `ClaimBaton`): Test `TestRoomBaton` FAIL.
  - M7 (Phản chứng RLS): Tắt RLS hoặc gỡ `FORCE RLS` làm các ca test bảo mật FAIL ngay lập tức (`TestRoomInviteJoinUnderRLS`: thành viên đọc được hàng vé ngoài phạm vi).
- **Sabotage catalog tự kiểm 007:** Sabotage cả 5 mệnh đề 3a–3e trong khối `DO $$` của `007_room_api.sql`, cả 5 lần migration đều hủy bỏ với `RAISE EXCEPTION` đúng kỳ vọng.

---

## 4. Kiểm tra Frontend & Ánh xạ lỗi

- `npm run check:i18n` chạy trên frontend pass 100%, không thiếu key.
- Các mã lỗi trả về từ Gin (`token_expired`, `forbidden`, `not_found`, `bad_request`, `already_member`) tương thích hoàn toàn với schema lỗi `api-error.ts` và từ điển `error.json` (vi/en).

---

## 5. Kết luận

Task161 hoàn thành xuất sắc tất cả tiêu chuẩn chất lượng khắt khe nhất của SQLLens. Toàn bộ code tuân thủ Zero-Log Transit, Core Rule 7, RLS đa tầng và phân quyền chuẩn mực. 

**Chấp thuận nghiệm thu và khuyến nghị merge ngay vào `main`.**
