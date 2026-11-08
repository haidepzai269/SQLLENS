# Bàn giao Task081: Xây dựng bộ test Playwright E2E Golden Path 10 bước

Thuộc: SP013 / STR060  
Người làm: Amelia  
Reviewer: task-reviewer (PASS 100%)  

## Đã làm:
- Xây dựng trọn vẹn bộ test Playwright E2E Golden Path trong file mới `web/e2e/golden-path.spec.ts` đi qua đầy đủ 10 bước theo hành trình người dùng:
  1. **Bước 1:** Truy cập `/{lang}/about`, kiểm tra tiêu đề, heading, bấm CTA "Vào phòng Lab" / "Enter Lab" -> chuyển trang `/{lang}` và kích hoạt `data-hydrated`.
  2. **Bước 2:** Bấm nút "Mẫu SQL" / "Sample SQL" -> nạp mẫu SQL mẫu đầy đủ hai bảng `users`, `orders` (có FK), dữ liệu `generate_series` và query JOIN bọc hàm `lower(u.email)`.
  3. **Bước 3:** Nhấn phím tắt `ControlOrMeta+Enter` (hoặc nút Chạy) -> PGlite chạy trên trình duyệt Web Worker -> Result Grid hiển thị đúng 3 dòng kết quả, badge `Thật` (`Real`) và evidence text.
  4. **Bước 4:** Tab Sơ đồ (Schema): kiểm tra các node bảng `users`, `orders`, huy hiệu quan hệ Foreign Key (`FK`), đường nối liên kết (edge), tương tác pan canvas bằng phím `Space`.
  5. **Bước 5:** Tab Luồng thực thi (Plan): kiểm tra Cây kế hoạch nhãn `Thật`, khối hoạt ảnh Join (Join animation) với trạng thái `data-step="0"`.
  6. **Bước 6:** Tab B-Tree: kiểm tra B-Tree Reader rơi key đơn, chuyển đổi Range Scan, thanh cuộc đua BTreeRace hiển thị số trang/dòng đọc được (nhãn Thật, tuyệt đối không chứa đơn vị thời gian ms/giây theo Nguyên tắc 3).
  7. **Bước 7:** Tab Rủi ro (Findings): kiểm tra danh sách rủi ro (bọc hàm), click rủi ro kích hoạt highlight CodeMirror (`.cm-sql-hit`) và focus node bảng tương ứng trên sơ đồ.
  8. **Bước 8:** Tab Thử sửa (What-if): áp dụng cách sửa trong transaction bằng cách gõ `CREATE INDEX idx_users_lower_email ON users (lower(email));`, bảng so sánh trước và sau hiển thị số trang, số dòng và nhãn Thật.
  9. **Bước 9:** Tab Tranh chấp (Conflict): chọn kịch bản Deadlock do cập nhật ngược thứ tự, chạy timeline nhịp qua nút Bước tới, đồ thị chờ khóa Cytoscape phát hiện chu trình chờ `data-cycle="true"` và tiêu chí hỏng deadlock mang nhãn `Mô phỏng`.
  10. **Bước 10:** Kiểm tra song ngữ (`/vi` và `/en`) và 2 kích thước màn hình chuẩn (Desktop 1440x900 và Mobile 390x844). Xác nhận màn hình không bị tràn ngang (`document.documentElement.scrollWidth <= window.innerWidth`). Kiểm tra toàn diện không có bất kỳ chuỗi nào hàm ý "thiết kế này ổn" (Nguyên tắc 2), mọi nhãn kết luận tuân thủ danh mục hợp lệ (Nguyên tắc 1).
- Cập nhật `SAMPLE_SQL` trong `web/src/components/sql-editor/samples.ts` để câu mẫu nạp sẵn có cấu trúc quan hệ FK, index và câu JOIN bọc hàm thích hợp cho cả 3 trụ cột (Thấy bên trong, Thử kịch bản hỏng, Kiểm tra thiết kế).
- Sửa lỗi đệ quy ngữ cảnh GSAP `getTweens` khi chuyển từ `/about` sang `/` trong `web/src/modules/landing/about-page.tsx` và `web/src/modules/landing/hero.tsx`.

## File chính:
- `web/e2e/golden-path.spec.ts`
- `web/src/components/sql-editor/samples.ts`
- `web/src/modules/landing/about-page.tsx`
- `web/src/modules/landing/hero.tsx`
- `_bmad-output/SP013/STR060/Task081/ban_giao_task081.md`

## Kết quả kiểm tra bằng máy:
- `npm run check`: Thoát mã 0 (i18n check sạch, lint 0 lỗi, typecheck sạch, 46 test suite với 517 unit tests đạt 100%).
- `npx playwright test e2e/golden-path.spec.ts`: Đạt 4/4 kịch bản (Desktop 1440x900 + Mobile 390x844 trên cả Tiếng Việt và English) trong 44.0 giây.

## Kết quả review:
- Reviewer: task-reviewer độc lập.
- Kết luận: PASS 100% (0 lỗi confirmed, 0 lỗi needs_validation). Đủ điều kiện hợp nhất vào main.

## Chưa làm được:
- Không.

## Phát sinh:
- Không.

## Việc tiếp theo cần biết:
- Bộ test `golden-path.spec.ts` có thể đưa vào CI release gate để đảm bảo mọi thay đổi trong tương lai không làm gián đoạn luồng trải nghiệm chính của người dùng.
