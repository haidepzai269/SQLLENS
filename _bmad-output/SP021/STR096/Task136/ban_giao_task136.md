# Bàn giao Task136

Đã làm: Hiện thực hóa module phân tích đồ thị phụ thuộc khóa ngoại `buildDependencyGraph` và thuật toán sắp xếp tô-pô tất định (deterministic) `topoSort` theo thuật toán Kahn kết hợp DFS chu trình. Bảng cha luôn đứng trước bảng con, tie-breaking theo `localeCompare`, bảng tự tham chiếu (self-ref) không bị coi là chu trình, đỉnh cô lập vẫn được sắp xếp đầy đủ, và chu trình được phát hiện trả về `cycles`.

File chính:
- `web/src/modules/export/types.ts` (kiểu TableSpec, DependencyGraph, TopoSortResult, DependencyGraphError)
- `web/src/modules/export/dependency-graph.ts` (thuật toán buildDependencyGraph và topoSort)
- `web/src/modules/export/dependency-graph.test.ts` (17 unit tests bao phủ AC1–AC6 và các ca biên)

Kết quả kiểm tra:
- `npx vitest run src/modules/export/dependency-graph.test.ts`: PASS 17/17 tests (27ms).
- `npm run typecheck`: PASS (0 lỗi).
- `npm run lint`: PASS (0 lỗi, 1 warning có sẵn ở `plan-explain.spec.ts`).
- `npm run check`: PASS toàn bộ 95 test files (1.119 unit tests).
- AC1: 5 bảng xáo trộn sắp xếp đúng thứ tự cha trước con.
- AC2: Chu trình A↔B và A→B→C→A trả trong `cycles`, không treo, không văng lỗi.
- AC3: Tự tham chiếu (`canonicalRefTable === tableName`) không bị tính là chu trình.
- AC4: Tính tất định 100% (chạy 10 lần kết quả giống hệt nhau).
- AC5: Bảng không FK và không ai trỏ tới đều nằm trong `order`.
- AC6: Phủ đủ 6 kịch bản bắt buộc.
- Ca biên: 200 bảng chạy dưới 2ms; FK trỏ bảng không tồn tại ném `DependencyGraphError` (`fk_target_missing`); xử lý case-insensitive tên bảng.

Kết quả review:
- Reviewer độc lập (context mới) nghiệm thu PASS 100% ngay vòng 1 (0 lỗi confirmed, 0 needs_validation).

Chưa làm được: Không có.
Phát sinh: Không có.

Việc tiếp theo cần biết: Task 137 (STR096) sẽ sử dụng kết quả `order` và `cycles` từ `topoSort()` để serialize câu lệnh DDL theo dialect (Postgres, MySQL, SQLite), đồng thời tách các khóa ngoại gây chu trình thành khối `ALTER TABLE ... ADD CONSTRAINT` ở cuối file.
