# Việc cập nhật Google Doc

**Trạng thái:** tạm gác. Chỉ làm khi chủ dự án yêu cầu.

**Tài liệu:** [Google Doc của dự án](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)

## Cách làm

1. Đọc `CLAUDE.md`. Nếu file đó khác với danh sách dưới đây, theo `CLAUDE.md`.
2. Dùng skill `google-workspace` và connector Google Docs. Connector Google Drive không sửa được file tại chỗ.
3. Sửa ngay trên file hiện tại và giữ nguyên link. Không tạo file mới.
4. Chỉ đổi các phần được liệt kê, giữ nguyên câu chữ còn lại.
5. Đọc lại Doc để kiểm tra, rồi đổi trạng thái ở đầu file này thành đã xong.

Số mục dưới đây theo bản Doc xuất ngày 2026-11-02. Doc có thể đã đổi, nên đọc lại trước khi sửa.

## Danh sách thay đổi

| Mục trong Doc | Việc cần làm |
|---|---|
| 1. Tổng quan | Giữ nguyên, thêm mục tiêu: giúp lập trình viên thấy thiết kế hỏng ở đâu trước khi code. Sửa "Zero-latency": chỉ đúng với PostgreSQL, MySQL đi qua mạng |
| 2. Thị trường | Giữ nguyên, thêm PGSimCity, QueryForge và deadlocker vào nhóm đối thủ từng phần |
| 3.1 Schema và dữ liệu | Giữ nguyên, thêm luồng dán SQL, và việc suy ra schema từ query để người dùng xác nhận trước khi chạy |
| 3.2 B+Tree và luồng thực thi | Đổi nguồn của cây sang `pageinspect` (PostgreSQL, nhãn Thật) và dựng lại từ dữ liệu thật (MySQL, nhãn Mô phỏng). Giữ phần animation, thêm mục "Giao diện B-Tree" và "Giao diện join" trong `CLAUDE.md`. Ghi rõ Merge Join chỉ có ở PostgreSQL |
| 3.3 Tranh chấp | Tách theo engine: PostgreSQL có 5 kịch bản giả lập, đối chiếu Postgres thật trong CI. MySQL chạy hai connection thật và đọc `performance_schema.data_lock_waits`. Dirty Read chỉ demo trên MySQL |
| 3.4 Bắt lỗi | Giữ nguyên danh sách lỗi, thêm: mỗi kết luận mang một nhãn và có bằng chứng, không bao giờ nói "thiết kế này ổn" |
| 3.5 AI Mentor | Key nằm ở Gin, xoay tua model. AI chỉ nhận dữ liệu làm bằng chứng và không gọi công cụ. SQL của AI phải chạy thử trước khi hiển thị |
| 3.5 AI Chaos Generator | Chưa có trong phạm vi đã chốt. Không tự xóa, hỏi chủ dự án |
| 3.5 Capacity Advisor | Viết lại theo mục "Capacity Advisor" trong `CLAUDE.md`: AI chỉ giải thích số đã tính, không tự đưa ra số |
| 3.6 Giả lập quy mô | Bỏ việc can thiệp `pg_class`. Thay bằng dữ liệu thật ở mức 10k, 100k, tối đa 500k, trên mức đó dùng công thức và gắn nhãn Ước lượng. Đồng hồ đo chỉ còn số tầng, dung lượng index và số trang đọc. Bỏ latency và QPS |
| 3.7 Đa mô hình | Giữ nguyên, các tab NoSQL và LSM-Tree vẫn khóa |
| 4. Mở đầu | Bỏ "client-side" hoàn toàn. Thay bằng sơ đồ trong mục "Kiến trúc" của `CLAUDE.md` |
| 4.1 Công nghệ | Next.js, shadcn/ui, GSAP, Gin trên Render, MySQL trên Oracle. PGlite khoảng 5,1 MB sau gzip. Bỏ sql.js. Parser là `pgsql-parser` và `node-sql-parser`. Bỏ cây TypeScript order 3-4 làm nguồn chính. Bỏ Gemini 2.5 Flash cố định |
| 4.2 Bảng khả thi | Bỏ cột số tuần, đổi sang thời hạn 7 ngày. Sửa ghi chú dòng 2 và dòng 6 cho khớp mục 3.2, 3.6. Ghi chú dòng 3 thêm MySQL thật |
| 5.1 Scale Gap | Bỏ giải pháp giả thống kê và câu "đang mô phỏng bảng 1.000.000 dòng". Thay bằng dữ liệu thật như mục 3.6 |
| 5.2 Giới hạn WASM | Giữ cho PostgreSQL, thêm đối chiếu trong CI. Thêm MySQL dùng khóa thật |
| 5.3 Quá tải thị giác | Giữ nguyên, thêm gom node kiểu `+206 node` |
| 5.4 Khác biệt engine | Bỏ "chọn một engine". V1 làm cả hai, thêm bảng "Khác biệt giữa hai engine" trong `CLAUDE.md` |
| 5.5 AI | Giữ kiến trúc hai tầng. Với MySQL, chạy thử trên sandbox. Bỏ "đảm bảo chạy được 100%". So sánh bằng số dòng và số trang đọc |
| 6. Lộ trình | Thay lộ trình 13 tuần bằng 7 ngày và mốc kiểm tra cuối ngày 3 trong `CLAUDE.md`. Giữ NoSQL ở sau V1 |

## Mục cần thêm

- **Nguyên tắc không được phá:** lấy từ `CLAUDE.md`.
- **Đăng nhập và bảo mật:** PostgreSQL dùng tự do, MySQL và AI phải đăng nhập, không ghi log SQL của người dùng, SQL người dùng chạy bằng role quyền thấp.
- **Ngôn ngữ:** tiếng Việt và tiếng Anh song song từ đầu, CI báo lỗi khi thiếu bản dịch.
- **Quy trình làm việc:** tóm tắt và dẫn đến `_bmad-output/QUY_TRINH.md`.

## Chưa chốt, không tự quyết

- Trình soạn thảo SQL: Doc ghi Monaco, chưa có quyết định trong `CLAUDE.md`.
- Thư viện vẽ sơ đồ: Doc ghi React Flow, chưa có quyết định trong `CLAUDE.md`.
- Tên sản phẩm: vẫn tạm dùng SQLLens.
