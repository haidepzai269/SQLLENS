# Bàn giao Task008

Đã làm: Khóa hợp đồng chung `Conclusion`/`Outcome`/`NotSimulated`, `EngineAdapter`, `ApiError` đúng nguyên văn task, thêm hàm `isApiError`. Không phải chỉnh chi tiết nào.
File chính: `web/src/contracts/conclusion.ts`, `web/src/contracts/engine.ts`, `web/src/contracts/api-error.ts`, `web/src/contracts/contracts.test.ts`.
Kết quả kiểm tra (chạy thật): `npm ci` thoát 0. `npm run check` thoát 0 (eslint sạch, tsc sạch, vitest 2 file / 3 test qua). Tạm xóa dòng `@ts-expect-error` của AC3 thì `npm run typecheck` đỏ (TS2322, thoát 2), đã khôi phục. Vậy file test nằm trong phạm vi typecheck (`tsconfig` include `**/*.ts`).
Kết quả review: task-reviewer mới, 0 lỗi, 0 needs_validation. Ghi chú không phải lỗi: `isApiError` chấp nhận trường thừa trong `error`; `Evidence.kind` là `string` tự do theo hợp đồng.
Chưa làm được: không có.
Phát sinh: không có. Lưu ý kỹ thuật: khi thiếu thuộc tính, TypeScript báo lỗi tại tên biến chứ không tại literal, nên `@ts-expect-error` của AC1 đặt trên dòng khai báo biến.
Việc tiếp theo cần biết: các module trả kết luận phải dùng `Outcome<T>`; Task009 (Go) trả `{error:{code,messageKey}}` cùng dạng với `ApiError`. Test dùng `export const` cho các giá trị AC1-AC4 để tránh lỗi unused.
