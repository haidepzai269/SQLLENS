# EXPERIENCE.md: SQLLens

Cách giao diện hoạt động. Nhìn và cảm giác ở `DESIGN.md`. Nguồn: mẫu đã duyệt ở `_bmad-output/SP001/STR002/Task004/` và các dòng giao diện trong `CLAUDE.md`. Mọi chuỗi hiển thị đi qua `messages/<vi|en>/<module>.json`, không viết cứng trong code.

## 1. Câu hỏi của màn hình

Thiết kế database của tôi hỏng ở đâu, và bằng chứng là gì. Vùng giữa (mô phỏng) là khối lớn nhất. Cột phải là kết luận kèm bằng chứng. Cột trái và terminal là đầu vào và nhật ký.

## 2. Luồng từ dán SQL đến kết luận

1. **Chọn engine** (PostgreSQL hoặc MySQL) ở thanh trên. PostgreSQL dùng tự do. MySQL cần đăng nhập. Chưa đăng nhập thì chọn MySQL mở hộp thoại đăng nhập, không mất SQL đã dán.
2. **Dán SQL** vào cột trái (CodeMirror 6). Parser tách thành danh sách câu. Một dòng đang chọn, đánh dấu bằng đường `lamp`.
3. **Chỉ có query, chưa có schema:** hệ thống suy ra schema từ query và hiện để người dùng xác nhận hoặc sửa. Chưa xác nhận thì chưa chạy.
4. **Bấm Chạy.** Đây là hành động duy nhất khởi động engine và animation. Dán, chọn câu, đổi tab, kéo thanh quy mô không tự chạy gì.
5. **Xem bên trong:** tab cảnh ở vùng giữa (cây B-Tree, luồng thực thi, sơ đồ schema). Animation chạy từng bước, tua lại được.
6. **Đọc kết luận** ở cột phải: danh sách thẻ rủi ro, mỗi thẻ có một mức độ, một nhãn kết luận và bằng chứng (số dòng, số trang đã đọc).
7. **Sửa và chạy lại:** người dùng sửa SQL hoặc thử cách sửa, bấm Chạy lần nữa, thẻ cập nhật. Kết quả cũ không biến mất ngầm: thẻ đổi thì có dấu cho biết đã đổi sau lần chạy này.

Nguyên tắc nội dung kết luận (từ `CLAUDE.md`):

- Mỗi kết luận có đúng một nhãn Thật, Mô phỏng, Ước lượng, hoặc trạng thái Chưa mô phỏng được.
- Không bao giờ nói "thiết kế này ổn". Chỉ nói: với giả định này, kịch bản này hỏng hoặc không hỏng ở bước nào, luôn ghi kịch bản và giả định.
- So sánh bằng số dòng và số trang đã đọc, không đưa thời gian chạy sandbox như dự đoán production.
- Nhật ký terminal ghi số thứ tự, không ghi giờ, không ghi thời gian chạy, không chép nội dung SQL của người dùng.

## 3. Trạng thái

Mỗi vùng có đủ bốn trạng thái dưới đây. Câu chữ có tiếng Việt và tiếng Anh.

| Trạng thái | Hành vi |
|---|---|
| **Tải** | Dùng `Skeleton` của shadcn/ui đúng hình dạng nội dung. Khi nạp PGlite (khoảng 5,1 MB nén) hiện thanh tiến độ và câu "Đang nạp PostgreSQL trong trình duyệt". Nút Chạy bị khóa và ghi rõ vì sao. Không hiện số tạm. Tải dài hơn dự kiến thì có nút Thử lại, vì PGlite có thể treo không báo lỗi |
| **Rỗng** | Nói rõ thiếu gì và làm gì tiếp: cột trái "Dán SQL để bắt đầu" kèm nút nạp câu mẫu, cột phải "Chưa có kết luận. Bấm Chạy". Vùng giữa chưa có cảnh thì hiện hướng dẫn một câu, không vẽ cây giả |
| **Lỗi** | `Alert` shadcn/ui: nói chuyện gì xảy ra, ảnh hưởng gì, làm gì tiếp. Lỗi parse không chặn việc chạy trên MySQL thật (parser MySQL chỉ là phụ). Lỗi SQL của người dùng hiện ở dòng câu SQL đó. Lỗi hệ thống (mạng, sandbox, quota) hiện ở vùng bị ảnh hưởng, các vùng còn lại vẫn dùng được. Không hiện stack trace, không hiện nội dung SQL trong thông báo lỗi chung |
| **Chưa mô phỏng được** | Không phải lỗi. Khối viền đôi 3 px cùng kiểu nhãn, ghi lý do cụ thể (ví dụ index không phải B-Tree), không đưa số nào, không màu đỏ. Mức độ của thẻ là "Cần xem lại". Không đoán |

Trạng thái đặc biệt:

- **Quá hạn mức hoặc hết quota:** nói rõ hạn mức, khi nào có lại, PostgreSQL vẫn dùng được.
- **Backend ngủ hoặc ngoài giờ giữ thức (24:00 đến 7:00 giờ Việt Nam):** báo có thể chậm hơn, không báo lỗi.
- **Mất phiên MySQL:** báo phiên đã hết, giữ nguyên SQL, cho chạy lại.

## 4. Bố cục và các cột

Ba cột cộng panel terminal ở dưới.

| Vùng | Mặc định | Khoảng đổi kích thước |
|---|---|---|
| Cột SQL (trái) | 320 px | 220 đến 560 px |
| Vùng giữa (mô phỏng) | phần còn lại, khoảng 770 px ở 1440 px | tự giãn |
| Cột rủi ro (phải) | 348 px | 260 đến 560 px |
| Terminal (dưới) | 180 px | 96 đến 480 px |

- **Bật tắt:** bốn nút ở góc trên phải, mỗi nút một vùng (`aria-pressed`). Vùng tắt thì các vùng còn lại giãn lấp chỗ. Vùng cuối cùng còn bật thì nút của nó bị khóa (`aria-disabled`), không bao giờ có màn hình trống.
- **Đổi kích thước:** kéo đường chia. Đường chia là `role="separator"` có thể focus. Phím mũi tên đổi theo bước nhỏ, Shift cộng mũi tên đổi bước lớn, Home và nhấp đúp về mặc định. Giá trị bị kẹp trong khoảng ở bảng trên.
- **Ghi nhớ:** kích thước và trạng thái bật tắt lưu ở `localStorage`, luôn bọc `try/catch`. Không lưu được thì vẫn chạy bằng mặc định.
- **Skip link** đầu trang nhảy tới vùng giữa. Thứ tự Tab: thanh trên, cột SQL, vùng giữa, cột rủi ro, terminal.
- **Terminal:** nhật ký cuộn, không bao giờ cắt dở dòng đầu: khoảng đệm nằm ngoài vùng cuộn và chiều cao canh theo bội số 20 px của dòng.
- **Ô SQL:** tự xuống dòng. Số dòng ở lề tính theo dòng logic, một câu dài nhiều dòng hiển thị vẫn một số.

## 5. Điện thoại

- Từ 900 px trở xuống: màn hình thành bốn tab ở đáy (SQL, Cảnh, Rủi ro, Terminal). Chỉ một vùng hiện. Đường chia và nút bật tắt vùng ẩn đi. Tab đang chọn có đường `lamp` 1 px.
- Từ 640 px trở xuống: cây và câu giải thích ghép vào một vùng cuộn chung. Câu giải thích dính ở đáy vùng, không bao giờ khuất.
- Lề trái và phải 16 px (`--edge`). Chữ thân bài 14 px. Vùng bấm tối thiểu 44 px chiều cao.
- Phần "Cuộc đua" Seq Scan và Index Scan nằm dưới màn hình đầu tiên và phải cuộn mới thấy. Phải có dấu hiệu cho biết còn nội dung bên dưới.
- Không có thao tác nào chỉ dùng được bằng hover. Kéo thả có thay thế bằng bàn phím và nút.
- Yêu cầu kiểm tra: ở 390 px không có cuộn ngang của trang.

### Hai điểm yếu của mẫu, thành yêu cầu bắt buộc

**Y1. Node kéo sát nhau không được chồng chữ.** Khi hai thẻ hoặc node trên canvas (sơ đồ bảng, cây plan, cây B-Tree ở "Kéo tự do") đặt sát hoặc chồng lên nhau, chữ của thẻ này không được đè lên chữ của thẻ kia, và không được che mất tên bảng, tên cột, khóa. Cách đạt: trong lúc kéo thẻ đang kéo nổi lên trên và có thể tạm che thẻ khác, còn yêu cầu không chồng chữ áp dụng sau khi thả; thẻ không co chữ, chữ cắt bằng dấu ba chấm có `title`; khoảng cách tối thiểu giữa hai thẻ khi thả là 8 px, nếu chồng thì đẩy thẻ vừa thả ra khỏi vùng chồng; nút "Xếp lại" luôn về bố cục chuẩn không chồng. Kiểm bằng ảnh chụp sau khi kéo hai thẻ chạm nhau.

**Y2. Cụm nút canvas không che thẻ trên điện thoại.** Cụm nút zoom, vừa màn hình, xếp lại ở góc dưới phải không được nằm đè lên thẻ hoặc câu giải thích dính ở đáy. Cách đạt: dưới 640 px cụm nút thu thành một hàng ngang gọn nằm trên vùng canvas (không đè lên nội dung), chừa khoảng đệm cuối vùng canvas bằng chiều cao cụm nút để thẻ cuối cuộn ra khỏi chỗ cụm nút, và cụm nút không bao giờ nằm trên câu giải thích dính. Kiểm ở 390 px với thẻ cuối cùng.

## 6. Kéo thả trên canvas

Áp dụng cho sơ đồ bảng và cây plan (React Flow), và cây B-Tree ở chế độ "Kéo tự do". Không chép bộ kéo thả JS thuần của mẫu, dùng React Flow.

| Thao tác | Cách làm |
|---|---|
| Di chuyển thẻ | Kéo thẻ, hoặc focus rồi bấm phím mũi tên. Mỗi bước 16 px, Shift cộng mũi tên 64 px |
| Di chuyển canvas | Kéo khoảng trống, hoặc giữ Space rồi kéo ở bất kỳ đâu |
| Zoom | Cuộn chuột, pinch, hoặc cụm nút ở góc dưới phải. Khoảng 0,3 đến 1,6 |
| Vừa màn hình | Nút trong cụm, không phóng quá 100% |
| Về bố cục chuẩn | Nút "Xếp lại", đồng thời xóa bản lưu của canvas đó |

- Lưới chấm `canvas-dot`, ô 24 px, co giãn theo zoom. Cây B-Tree ở "Cố định" để nền trơn.
- Cạnh nối với thẻ đang kéo đổi sang màu `lamp`. Không có cạnh chạy liên tục.
- Lưu vị trí ở `localStorage` có `try/catch`: `sqllens.schema.*` và `sqllens.plan.*` tách riêng bản rộng và bản hẹp, `sqllens.btree.pg` và `sqllens.btree.my` lưu độ lệch node, `sqllens.btree.mode` lưu kiểu di chuyển.
- Bố cục chuẩn: bản rộng xếp hai cột cho sơ đồ bảng và dạng cây cho plan. Bản hẹp dưới 560 px xếp một cột, cạnh của plan đi theo đường rail bên trái.
- Giảm chuyển động: kéo và zoom không có chuyển tiếp.

## 7. Cây B-Tree: hai kiểu di chuyển

Công tắc hai vị trí trên đầu cảnh B-Tree, có thể chọn bất cứ lúc nào, nhớ ở `sqllens.btree.mode`.

- **Cố định (mặc định):** cây dựng theo bố cục tính sẵn, node không kéo được. Nền trơn. Phù hợp để đọc và so sánh.
- **Kéo tự do:** node kéo được. Mỗi lần node đổi vị trí, cây và timeline dựng lại từ vị trí hiện tại rồi tua tới đúng thời điểm cũ, nên key không bay về chỗ cũ. Nếu cảnh đang chạy thì chạy tiếp. Node được khóa theo vị trí so với đường đi, nên đổi quy mô dữ liệu vẫn giữ phần lớn độ lệch.
- Ở "Kéo tự do" luôn hiện câu "Vị trí kéo chỉ để dễ nhìn, không đổi thứ tự key thật", nằm cùng khối với câu giải thích để không bị che khi di chuyển canvas.
- Kéo node không bao giờ đổi dữ liệu, thứ tự key, số trang đọc hay nhãn kết luận.

Các thành phần của cảnh (từ `CLAUDE.md`):

- Key rơi từ root qua internal xuống leaf, chạy từng bước và tua lại. Mỗi bước có một câu giải thích.
- Bốn trường hợp theo câu SQL: tìm một key; quét một khoảng (trượt ngang qua các leaf); không dùng được index (cây tối đi, quét toàn bộ); index không phải B-Tree (Chưa mô phỏng được).
- Cuộc đua giữa Seq Scan và Index Scan, so bằng số trang đã đọc.
- PostgreSQL: nhảy từ index sang heap. MySQL: hai cây, key rơi qua secondary rồi qua clustered.
- Thanh quy mô năm mức 10k, 100k, 500k, 1M, 10M. Cây tự thêm tầng, số liệu tính lại. Từ 1M trở lên nhãn đổi thành Ước lượng. Đến 500k nhãn theo nguồn: Thật (PostgreSQL) hoặc Mô phỏng (MySQL).
- Node quá nhiều thì gom thành cụm viền đứt `+N node`, N tính từ tổng trang trừ số node đang hiện.
- Khung B-Tree có hai nhãn ở hai vị trí khi có cả cây và số liệu Capacity Advisor, vì là hai kết luận.
- Cây không dùng `viewBox` co giãn. Dựng theo kích thước thật của vùng chứa nên chữ giữ cỡ ở mọi chiều rộng.

## 8. Animation chỉ chạy khi người dùng bấm Chạy

- Mọi animation mô phỏng (B-Tree, join, luồng thực thi, tranh chấp) bắt đầu từ nút Chạy hoặc nút Phát của chính cảnh đó. Mở màn hình, đổi tab, đổi engine, đổi quy mô, kéo node không tự phát.
- Trước khi bấm Chạy, cảnh hiện ở trạng thái tĩnh: cây đủ nét, chưa có key rơi.
- Trong khi chạy: Tạm dừng, Bước tới, Bước lùi, kéo thanh timeline để tua. Câu giải thích, nhật ký terminal và bộ đếm trang suy ra từ vị trí timeline, nên tua lại thì cả ba lùi theo. Hết thì có nút Chạy lại.
- **Ngoại lệ duy nhất:** landing page được tự chạy một lần khi hiện ra, để người xem thấy ý tưởng. Mẫu Task004 tự chạy một lần là để duyệt, sản phẩm không làm vậy.
- Giảm chuyển động (`prefers-reduced-motion: reduce`): nút Chạy phát từng bước đổi ngay, không chuyển tiếp, và có một dòng báo rõ chế độ này đang bật.
- Animation join chạy trên một mẫu nhỏ và ghi rõ đó là mẫu minh họa. Loại join và số dòng lấy từ plan thật.
- Animation không che thông tin: kết luận ở cột phải và con số luôn đọc được không cần xem animation.

## 9. Hành vi chung

- **Ngôn ngữ:** chuyển tiếng Việt và tiếng Anh ở thanh trên, không mất trạng thái. Chuỗi dịch trong `messages/<ngôn ngữ>/<module>.json`. Thiếu bản dịch thì CI báo lỗi. Tiếng Việt có chiều cao dòng đủ cho dấu, chữ không bị cắt khi dài hơn tiếng Anh.
- **Bàn phím:** mọi thao tác dùng được bằng bàn phím. Focus luôn thấy được (viền `lamp` 2 px). Tab trong cụm dùng mũi tên, nút bật tắt có `aria-pressed`.
- **Đọc màn hình:** cảnh B-Tree có bản tóm tắt văn bản của đường đi và số trang. Mỗi nhãn kết luận và mức độ có chữ, không chỉ có ký hiệu hay màu.
- **Đăng nhập:** chỉ chặn MySQL và AI Mentor. Hộp thoại nói rõ vì sao cần đăng nhập, và PostgreSQL vẫn dùng được không cần.
- **Riêng tư:** không ghi log SQL người dùng. Giao diện không gửi SQL ra ngoài trừ khi người dùng chọn MySQL hoặc AI, và nói rõ điều đó ngay chỗ chọn.
