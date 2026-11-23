# STR115 — Fork sang Local Sandbox

> Epic: SP024 | Trạng thái: **Chờ duyệt task**
> Điều kiện vào: STR114 xong (cần Yjs store để đọc nội dung tab hiện tại)
> Thứ tự: **Tầng 3 (STR116) chạy trước.** Story này chỉ mở sau khi Task170 xong.

## Mục tiêu

Bất kỳ thành viên nào trong phòng bấm "Fork về máy tôi" để nhân bản SQL của các tab thành dự án local mới trong IndexedDB. Dùng lại codec SP022 và hàm `forkSnapshot()` đã có ở `web/src/modules/share/fork.ts:126`. Không gửi SQL ra ngoài.

## Hai trần độc lập, cùng có hiệu lực

1. **Trần byte mỗi lần fork:** 32 KB cứng (`SNAPSHOT_HARD_LIMIT_BYTES`, `snapshot.ts:22`), cảnh báo từ 8 KB (`SNAPSHOT_WARN_LIMIT_BYTES`, `snapshot.ts:25`).
2. **Trần số phòng fork đồng thời:** tối đa 5 phòng. Vượt thì từ chối, **không** âm thầm xoá phòng cũ.

Hai trần này **không thay thế nhau**. Bản nháp v2 viết "5 fork thay vì cảnh báo byte" là sai — Task167 làm cả hai.

## Giao diện có

Có

## Nhãn

**Chưa đo.**

## Task

| Task | Mô tả | Trạng thái |
|---|---|---|
| Task167 | Fork to Local Sandbox: bọc `forkSnapshot()`, đếm phòng fork, hai trần, i18n | Chờ |

## Tiêu chí nghiệm thu Story

- AC1: Fork → dự án mới trong IndexedDB với tên `"[Phòng] — Fork [timestamp]"`
- AC2: SQL sao chép nguyên vẹn, thứ tự tab đúng
- AC3: Vượt 32 KB → từ chối kèm mã lỗi rõ ràng; từ 8 KB → cảnh báo nhưng vẫn cho fork. Không âm thầm bỏ dữ liệu.
- AC4: Đã có 5 phòng fork → từ chối phòng thứ 6, mã lỗi rõ ràng, phòng cũ nguyên vẹn
- AC5: Dự án phòng gốc không thay đổi
- AC6: **0 request mạng** trong toàn bộ luồng bấm Fork (IndexedDB only, Core Rule 7)
- AC7: `tsc --noEmit` sạch — mọi mã lỗi mới phải nằm trong union đóng của `ForkErrorCode` (`fork.ts:19`), không được truyền chuỗi tự do

> **Cơ chế đếm phòng fork là D20, chưa chốt.** Ba phương án ở "Sửa #5" trong `BAN_NHAP_STORY_SP024.md`. Không được thi công Task167 trước khi chủ dự án chọn.
