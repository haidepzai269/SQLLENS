# Task136: Đồ thị phụ thuộc khóa ngoại & sắp xếp tô-pô

Thuộc: SP021 / STR096
Mục tiêu: Biết bảng nào phải tạo trước bảng nào, và phát hiện vòng khóa ngoại để xử lý riêng.

Phạm vi:
- `web/src/modules/export/dependency-graph.ts`
- `web/src/modules/export/dependency-graph.test.ts`
- `web/src/modules/export/types.ts`

Không làm:
- Không sinh SQL (Task137).
- Không làm UI (Task138).
- Không đọc thẳng từ database; nhận schema đã chuẩn hóa qua `types.ts`.

Hợp đồng:
- `interface TableSpec { name: string; columns: ColumnSpec[]; foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[] }`
- `buildDependencyGraph(tables: TableSpec[]): DependencyGraph`
- `topoSort(graph: DependencyGraph): { order: string[]; cycles: string[][] }`
- Thứ tự trong cùng một bậc sắp theo tên bảng tăng dần để kết quả tất định.

Tiêu chí xong:
- AC1: 5 bảng khai báo lộn xộn cho ra thứ tự trong đó mọi bảng cha đứng trước bảng con.
- AC2: Chu trình A→B→A được phát hiện, trả trong `cycles`, không treo, không ném lỗi.
- AC3: Bảng tự tham chiếu (parent_id trỏ chính nó) không bị coi là chu trình.
- AC4: Cùng đầu vào cho ra cùng đầu ra (chạy 10 lần giống nhau).
- AC5: Bảng không có khóa ngoại và bảng không được tham chiếu đều có mặt trong `order`.
- AC6: Unit test phủ 6 kịch bản: chuỗi thẳng, rẽ nhánh, chu trình 2 bảng, chu trình 3 bảng, tự tham chiếu, schema rỗng.

Ca biên: 200 bảng; FK trỏ tới bảng không tồn tại trong schema (báo lỗi có mã, không im lặng); tên bảng trùng khác hoa thường.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/export/dependency-graph.test.ts`.
Góc review thêm: đúng logic, test thật.
Đọc thêm: `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 4 (STR096).
