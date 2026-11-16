# Bàn giao Task128

Đã làm:
- Xây dựng module `web/src/modules/workspace/engine-binding.ts`:
  + `bindEngine(projectId, engine)`: ghim engine vào dự án và cập nhật store/IndexedDB.
  + `currentEngine(projectId)`: đọc engine của dự án từ store.
  + `releaseProjectResources(projectId)`: nhả phiên container MySQL an toàn, bỏ qua lỗi mạng (không crash UI), tuyệt đối không log SQL (Core Rule 7).
  + `onProjectSwitch(prevId, nextId)`: bộ điều phối chuyển dự án, gọi nhả container đúng 1 lần (deduped), bảo vệ ca biên chuyển nhanh 5 lần trong 2 giây.
  + Hook/kênh thông báo `subscribeReleaseNotice` / `useEngineReleaseNotice`.
- Xây dựng component `<EngineReleaseToast />` tại `web/src/modules/workspace/components/engine-release-toast.tsx` hiển thị toast thông báo song ngữ vi/en khi nhả container gặp sự cố mạng (AC3), tự ẩn sau 5 giây, không chặn thao tác người dùng.
- Gắn `<ProjectSwitcher />` vào thanh `TabBar` (`web/src/modules/workspace/components/tab-bar.tsx`) với vạch ngăn phân cách `border-r border-line`, responsive mượt mà trên desktop và mobile.
- Tích hợp vào `web/src/modules/lab/lab-workspace.tsx`:
  + Đồng bộ hai chiều giữa `engine` trên URL và `project.engine` trong store: khi người dùng đổi tab Engine trên header, tự động cập nhật engine của dự án hiện tại vào store, đồng thời nhả container nếu đổi từ MySQL sang Postgres.
  + Khi chuyển dự án hoặc F5, URL tự động đồng bộ theo engine đã ghim của dự án.
  + Kế thừa engine khi tạo dự án mới trong `ProjectSwitcher`.
  + Giữ nguyên rào chắn STR088 (AC4): mở dự án MySQL KHÔNG tự tạo container, chỉ tạo khi bấm chạy.
- Khắc phục lỗi vòng 1 được reviewer phát hiện: đồng bộ hai chiều `engine` URL và `project.engine`, nhả container khi đổi EngineTabs trên cùng dự án, kế thừa engine khi tạo dự án mới.

File chính:
- `web/src/modules/workspace/engine-binding.ts`
- `web/src/modules/workspace/engine-binding.test.ts`
- `web/src/modules/workspace/components/engine-release-toast.tsx`
- `web/src/modules/workspace/components/tab-bar.tsx`
- `web/src/modules/workspace/components/project-switcher.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/modules/workspace/store.ts`
- `web/messages/vi/workspace.json`, `web/messages/en/workspace.json`

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100% (0 lỗi thiếu bản dịch).
- `npm run lint`: PASS 100% (0 error).
- `npm run typecheck`: PASS 100% (`tsc --noEmit` 0 lỗi).
- `vitest run`: PASS 92/92 tests (trong đó 9 tests `engine-binding.test.ts` và 23 tests `project-switcher.test.tsx`).

Kết quả review: Subagent task-reviewer độc lập thẩm định vòng 2 đạt chuẩn PASS 100% (AC1-AC6, sửa triệt để lỗi đồng bộ engine, Core Rule 7). Đủ điều kiện merge vào main. 0 mục `needs_validation` bắt buộc.

Chưa làm được: Không có.
Phát sinh (đưa vào SP999): Không có.

Việc tiếp theo cần biết:
- **HOÀN TẤT 100% STORY STR091!**
- Tiếp tục SP019 với Story STR092 (Chính sách máy dùng chung - Task 129, Task 130) hoặc chuyển sang Task 131 (Cổng đo lường SQLite WASM của SP020).
