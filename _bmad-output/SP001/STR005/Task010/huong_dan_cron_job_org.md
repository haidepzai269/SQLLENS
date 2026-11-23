# Hướng dẫn giữ Render thức bằng cron-job.org

Tài liệu này hướng dẫn chủ dự án tự dựng lịch gọi giữ thức cho backend Gin trên Render free bằng cron-job.org. Agent không tạo được tài khoản cron-job.org thay chủ dự án, nên toàn bộ thao tác dưới đây làm bằng tay trên web.

Bối cảnh: cơ chế cũ dùng cron của GitHub Actions trong `.github/workflows/keep-awake.yml` với biểu thức `*/10 0-16 * * *`. Đo thật ngày 2026-11-23 cho thấy cơ chế đó **không đáng tin**: chỉ chạy **64 lần trong 20,66 ngày**, tức **3,1 lần/ngày** thay vì 144 lần/ngày như thiết kế. Cả **63/63** khoảng cách giữa hai lần chạy đều vượt ngưỡng ngủ 15 phút, nhỏ nhất 136,7 phút, trung vị 462,6 phút, lớn nhất 710,9 phút. Nguyên nhân là GitHub Actions dồn và bỏ nhịp cron khi tải cao. Vì vậy chủ dự án chốt chuyển sang cron-job.org.

## 1. Đăng ký tài khoản

1. Mở `https://cron-job.org` bằng trình duyệt.
2. Bấm nút đăng ký và tạo tài khoản bằng địa chỉ email của chủ dự án.
3. Mở hộp thư, bấm liên kết xác nhận trong email mà cron-job.org gửi.
4. Đăng nhập lại sau khi xác nhận. Chỉ khi tài khoản đã xác nhận thì mới tạo được job.

## 2. Tạo job giữ thức

1. Trong bảng điều khiển, bấm nút **Create cronjob**.
2. Điền **Title**: `SQLLens keep-awake`.
3. Điền **URL**: `https://sqllens.onrender.com/healthz`.

   **Cảnh báo quan trọng: phải dùng `/healthz`, tuyệt đối không dùng `/api/healthz`.** Đường `/api/healthz` chỉ tồn tại khi request đi qua rewrite của Vercel; gọi thẳng vào Render thì `/api/healthz` trả 404 (đã kiểm ngày 2026-11-23). Route `/healthz` được đăng ký tại `api/internal/httpapi/router.go:60` và cố ý không chạm dịch vụ ngoài, nghĩa là không chạm Neon và không chạm Upstash. Nhờ vậy lệnh ping giữ thức không đánh thức Neon, và Neon vẫn tự tắt để tiết kiệm CU-giờ.

4. **Schedule**: chọn **Every 10 minutes**, sau đó giới hạn giờ chạy. Cửa sổ cần giữ thức là **7:00–24:00 giờ Việt Nam**, tương đương **00:00–16:50 UTC**.
   - Nếu giao diện chỉ cho nhập biểu thức cron thì dùng `*/10 0-16 * * *` và đặt timezone là `UTC`.
   - cron-job.org có ô chọn timezone, nên cũng có thể đặt timezone là `Asia/Saigon` và dùng biểu thức `*/10 7-23 * * *`. Hai cách cho cùng một cửa sổ giữ thức; chỉ cần chọn một cách và kiểm lại giờ chạy hiển thị trên trang job.
5. **Method**: `GET`.
6. Bật tùy chọn **"Notify me when the job fails"** để nhận email cảnh báo khi job hỏng.
7. Lưu job, rồi bấm chạy thử một lần bằng nút chạy tay có sẵn trên trang job để chắc chắn cấu hình đúng trước khi chờ lịch.

## 3. Vì sao chọn cron-job.org

Gói free của cron-job.org đủ cho nhu cầu giữ thức:

- Không giới hạn số job.
- Chu kỳ nhỏ nhất là 1 phút, dư so với nhu cầu 10 phút.
- Timeout 30 giây mỗi lần gọi, trong khi endpoint `/healthz` trả về tức thì.
- Giữ lại 50 lần chạy gần nhất để xem lại.
- Có email cảnh báo khi job hỏng.

Nguồn: trang FAQ chính thức `https://cron-job.org/en/faq/`, đọc ngày 2026-11-23. Các con số trong mục này là **Thật** theo tài liệu của nhà cung cấp, chưa phải số đo trên hệ thống của dự án.

## 4. Giới hạn phải biết

- cron-job.org **không cam kết đúng giờ tuyệt đối**. FAQ nói job có thể trễ trong giờ cao điểm, và dịch vụ có thể cố ý hoãn job nếu job hỏng nhiều lần. Vì vậy sau khi dựng phải **đo lại** theo mục 6, không tin lý thuyết.
- Job bị **tự tắt sau 25 lần hỏng liên tiếp**. Khi nhận email cảnh báo hỏng, phải vào kiểm job còn bật hay không.
- Mọi request từ cron-job.org đến từ **5 địa chỉ IP cố định**: `116.203.134.67`, `116.203.129.16`, `23.88.105.37`, `128.140.8.200`, `91.99.23.109`. Hiện không cần mở gì vì `/healthz` là công khai. Ghi lại để sau này nếu thêm chặn IP thì biết phải xử lý.
- Cấu hình job **không nằm trong git**, chỉ nằm trên tài khoản cron-job.org. Đây là cái giá của việc đổi: đáng tin hơn nhưng không version-control được. Vì vậy file `.github/workflows/keep-awake.yml` được giữ lại với `workflow_dispatch` làm đường dự phòng bấm tay khi cron-job.org hỏng.

## 5. Ngân sách giờ Render

Gói free của Render cho **750 giờ/tháng** cho cả workspace, và service ngủ sau 15 phút không có request.

- Giữ thức **7:00–24:00 giờ Việt Nam** là 17 giờ/ngày, khoảng **510 giờ/tháng**, tức **68 %** trần 750 giờ/tháng. Còn dư 240 giờ. Đây là phương án chọn.
- Giữ **24/7** là **730 giờ/tháng**, tức **97,3 %** trần, chỉ dư 20 giờ. Quá sát nên **không chọn**.

Nhãn **Ước lượng** cho toàn bộ phần giờ Render ở mục này: ngưỡng ngủ 15 phút lấy từ tài liệu Render, chưa đọc dashboard Render để đối chiếu số giờ tiêu thụ thật.

Ngoài cửa sổ giữ thức, request đầu tiên là một lần cold start khoảng **12,5 giây** (đã đo: 12.576 ms ngày 2026-11-23, nhãn **Thật**). Đây là hành vi đã chấp nhận: ban đêm service ngủ, người dùng đầu tiên chờ cold start.

## 6. Cách kiểm sau khi dựng

Phần này là điều kiện nghiệm thu. Dựng xong mà không đo thì chưa coi là xong.

1. **Xem lịch sử trên cron-job.org.** Vào trang job, mở lịch sử 50 lần chạy gần nhất. Mọi lần phải trả HTTP 200, và khoảng cách giữa hai lần liên tiếp phải xấp xỉ 10 phút. Nếu thấy lần nào trả mã khác 200, hoặc có khoảng cách lớn hơn 15 phút, ghi lại thời điểm và mã lỗi để xử lý.
2. **Đo bằng script.** Gọi `https://sqllens.onrender.com/healthz` mỗi 2 giây trong 20 phút và ghi lại thời gian phản hồi của từng request.
   - Nếu service thức, mọi request trả trong khoảng vài chục đến vài trăm ms.
   - Nếu service ngủ, sẽ có đúng một request mất khoảng 12,5 giây. Đó là cold start, không phải lỗi.
   - Đây chính là phép đo đã dùng ngày 2026-11-23: **600/600 request trả 200, 0 cold start, trung vị 83 ms** (nhãn **Thật**). Phản chứng của cùng ngày: im 20 phút rồi bắn một request thì mất **12.576 ms** (nhãn **Thật**).
3. **Ghi số đo thật.** Ghi kết quả vào `_bmad-output/SP024/STR108/Task159/ket_qua_do.md`, hoặc tạo file mới cạnh file đó nếu muốn giữ bản ghi riêng. Mỗi con số phải kèm nhãn **Thật** hoặc **Ước lượng** theo đúng nguyên tắc của dự án.

## 7. Khi nào phải xem lại

Xem lại toàn bộ cấu hình này khi một trong ba điều sau xảy ra:

- Render đổi chính sách gói free, đặc biệt là trần giờ chạy hoặc ngưỡng ngủ.
- cron-job.org đổi giới hạn gói free, đặc biệt là chu kỳ nhỏ nhất, số job, hoặc thời gian giữ lịch sử.
- Số giờ Render thật trên dashboard vượt **600 giờ/tháng**. Con số 510 giờ ở mục 5 là **Ước lượng**; dashboard là nguồn **Thật**, nên khi hai bên lệch nhiều thì tin dashboard và siết lại cửa sổ giữ thức.
