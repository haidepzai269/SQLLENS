# Bàn giao Task122

Đã làm: Xây dựng nền tảng lưu trữ IndexedDB cục bộ cho workspace (`sqllens-workspace`), thiết lập tách dữ liệu theo 2 tầng scope `guest` và `user_<uuid>`, đảm bảo xóa dự án kéo theo xóa toàn bộ tab con trong cùng transaction (`deleteProjectCascade`), xử lý ngoại lệ `QuotaExceededError` thành `WorkspaceQuotaError`, và bảo đảm 100% không có dữ liệu nào rời máy (Core Rule 7).
File chính:
- `web/src/modules/workspace/types.ts`: Kiểu dữ liệu `WorkspaceScope`, `WorkspaceEngine`, `WorkspaceProject`, `WorkspaceTab` và hàm `scopeKey`.
- `web/src/modules/workspace/db.ts`: Cấu trúc IndexedDB v1 với 3 store (`projects`, `tabs`, `meta`), index `by_scope`, `by_project`, và hỗ trợ dependency injection `IDBFactory`.
- `web/src/modules/workspace/repository.ts`: Repository CRUD, đóng gói transaction `runTx`, bắt lỗi quota `WorkspaceQuotaError`, cascade delete.
- `web/src/modules/workspace/repository.test.ts`: Bộ 13 unit tests chạy trên `fake-indexeddb`, bao phủ toàn diện AC1 - AC6 và các ca biên.
- `web/package.json`: Bổ sung devDependency `fake-indexeddb` phục vụ kiểm thử Node.js.
Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100%.
- `npm run lint`: PASS 100% (0 errors).
- `npm run typecheck`: PASS 100% (`tsc --noEmit` sạch lỗi).
- `npm run check`: 85 test files PASS, 959 tests PASS 100%, 0 failures.
- `npx vitest run src/modules/workspace/repository.test.ts`: 13/13 tests PASS (71ms).
- `cd api && go test ./...`: PASS 100%.
Kết quả review: Hội đồng BMAD và reviewer thẩm định trực tiếp nghiệm thu PASS 100% toàn bộ AC1 - AC6, giải quyết dứt điểm vòng đời đóng DB với `afterEach`, test quota qua transaction thật, và kiểm tra ranh giới network bằng regex.
Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Nền tảng storage đã sẵn sàng; Task123 sẽ triển khai store Zustand (`useWorkspaceStore`) và bộ autosave debounce 300ms dựa trên repository này.
