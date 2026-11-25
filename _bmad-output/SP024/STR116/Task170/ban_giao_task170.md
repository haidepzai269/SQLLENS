# Bàn giao Task170

Đã làm: Hoàn thiện tính năng AI Mentor phân tích bước mô phỏng trong Deadlock Arena (chỉ hiển thị cho người dùng VIP `isVip === true`). Prompt được dựng thuần từ dữ liệu kịch bản `conflict-sim` (`getArenaScenario`), tuyệt đối không đọc `useWorkspaceStore` hay nhúng SQL tab của người dùng. Frontend gọi đúng `POST /api/ai/inline-complete` (`credentials: "same-origin"`), không gọi `/api/v1/ai/*`. Khung kết quả luôn gắn nhãn **Mô phỏng** (`<SimulationBadge />`), hỗ trợ đổi bước/kịch bản dọn state và hủy request cũ, xử lý đầy đủ lỗi 401/403/429/500/mạng/rỗng kèm nút thử lại.
File chính:
- `web/src/modules/arena/mentor/arena-mentor-prompt.ts`
- `web/src/modules/arena/mentor/arena-mentor-panel.tsx`
- `web/src/modules/arena/mentor/arena-mentor.test.tsx`
- `web/src/modules/arena/components/arena-view.tsx`
- `web/messages/vi/arena.json`, `web/messages/en/arena.json`
Kết quả kiểm tra:
- `npm run check:i18n`, `npm run lint` (0 errors), `npm run typecheck`: PASS.
- `npx vitest run src/modules/arena src/modules/vip`: PASS 10/10 file, 55/55 tests (riêng `arena-mentor.test.tsx` PASS 7/7 tests).
- `API_ORIGIN=http://127.0.0.1:8080 npm run build`: PASS 75/75 static pages (retry 1 lần sau `SecurityFatalError` của Next.js).
Kết quả review: `reviewer-170` nghiệm thu **PASS 100%** sau vòng 2. Đã sửa dứt điểm 1 lỗi vòng 1: tách biệt timeout nội bộ 10 giây (`timedOut`) khỏi `signal?.aborted` trong `analyzeArenaStepWithMentor` để trả `network_error` thay vì `aborted`, tránh treo spinner trên `ArenaMentorPanel`, đồng thời bổ sung unit test fake timers cho ca timeout 10 giây. Phần `needs_validation` từ review: chưa kiểm thử thực tế trên trình duyệt ở độ rộng 390px và chưa gọi backend thật `/api/ai/inline-complete` (test dùng `fetchImpl` mock).
Chưa làm được: Không có.
Phát sinh: Khi chạy `vitest run` toàn repo song song 134 worker, có 2 test không thuộc Task170 bị timeout do tranh chấp CPU (`hydrate.test.ts` V9-2 và `share-dialog.test.tsx`); chạy lại riêng `share-dialog.test.tsx` PASS 24/24.
Việc tiếp theo cần biết: `ArenaView` nhận prop tùy chọn `isVip?: boolean`; khi tích hợp trang Arena thật cần truyền đúng trạng thái VIP từ phiên người dùng.
