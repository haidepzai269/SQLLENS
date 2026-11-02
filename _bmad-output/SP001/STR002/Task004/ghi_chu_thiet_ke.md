# Ghi chú thiết kế cho mẫu giao diện SQLLens

Tài liệu này ghi lại màu, font, khoảng cách và lý do của `mau_giao_dien.html`, để Task005 chuyển thành token sau khi chủ dự án duyệt. Mọi giá trị dưới đây trùng với khối `:root` trong file HTML.

## Ý tưởng chính

Màn hình này trả lời một câu hỏi: thiết kế database của tôi hỏng ở đâu, và bằng chứng là gì. Vì vậy vùng lớn nhất là hình mô phỏng, cột phải là kết luận kèm bằng chứng, còn cột trái và terminal là đầu vào và nhật ký.

Câu định hướng của tôi là: trên màn hình này, key đang được soi trở thành thứ duy nhất được chiếu sáng trên bàn thí nghiệm. Mọi thứ khác nằm trong bóng tối, cho đến khi key chạm tới. Vì vậy cả sản phẩm chỉ có một màu đèn, và màu đó luôn có nghĩa là "chỗ đang đọc" hoặc "đang được chọn".

Phần riêng của sản phẩm, không mẫu dashboard nào có, là đường đi sáng từ root qua internal xuống leaf, và bộ đếm số trang đọc chạy theo từng bước.

## Màu

| Token | Giá trị | Dùng cho | Lý do |
|---|---|---|---|
| `--ground` | `#171719` | Nền thanh trên và nền trang | Xám trung tính, không ngả xanh navy, để màu đèn nổi hẳn. |
| `--stage` | `#0E0E10` | Vùng mô phỏng và terminal | Tối nhất màn hình, như bàn soi. Mắt được kéo vào đây trước. |
| `--surface` | `#131217` | Cột SQL, cột rủi ro, thẻ node, thẻ bảng | Một bậc sáng hơn bàn soi, nên tách lớp mà không cần đổ bóng. |
| `--raised` | `#212023` | Dòng đang chọn trong danh sách câu SQL, rãnh thanh số liệu | Bậc sáng thứ ba, chỉ dùng cho trạng thái. |
| `--border` | `#2A2A2E` | Đường chia các vùng | Đường kẻ mảnh đúng cảm giác phòng lab. |
| `--rule` | `#1F1E23` | Đường kẻ giữa các dòng trong danh sách và bảng | Nhạt hơn đường chia vùng một bậc. |
| `--control` | `#3A3A3E` | Viền node, viền nút phụ, nhánh chưa đi qua | Đậm hơn đường chia để đọc được là vật thể. |
| `--text` | `#FFFFFF` | Chữ chính, số liệu chính | Đọc lâu trên nền tối vẫn rõ. |
| `--ink2` | `#C4C5C9` | Chữ phụ, nội dung SQL, khóa trong node | Tương phản khoảng 10:1 trên `--surface`. |
| `--muted` | `#92949A` | Nhãn nhỏ, chú thích, số dòng | Tương phản khoảng 6:1 trên `--surface`, vẫn đạt 4,5:1. |
| `--lamp` | `#F2B84B` | Đường đi của key, key, trang đang đọc, đường chọn 1 px, viền focus | Màu đèn soi mẫu vật. Đây là hue duy nhất cho dữ liệu và lựa chọn. |
| `--lamp-ink` | `#17130A` | Chữ trên nền đèn | Giữ tương phản trên thẻ key. |
| `--negative` | `#EF6B82` | Chữ "Hỏng ở bước N", cột thiếu index | Chỉ dành cho sự thật đang hỏng, luôn đi kèm chữ, không bao giờ chỉ có màu. |

Skill tham khảo đề nghị dùng màu xanh `#4A8AD6` làm điểm nhấn. Tôi thay bằng màu đèn vì màu xanh không gắn gì với hình ảnh phòng thí nghiệm, còn đèn soi thì giải thích được vì sao chỉ có một chỗ sáng. Tôi cũng giữ màu vàng cảnh báo ra khỏi bảng màu để màu đèn không bị đọc thành "cảnh báo".

Không có gradient, không có glow, không có glass. Lớp được tách bằng bậc sáng và đường 1 px.

## Nhãn kết luận

Bốn hình thức dưới đây hoàn toàn đơn sắc, nên phân biệt được cả khi không nhìn màu. Tôi đã chụp ảnh ở chế độ xám để kiểm tra. Mỗi nhãn khác nhau ở bốn thứ cùng lúc: chữ, ký hiệu, kiểu nền và kiểu viền.

| Nhãn | Ký hiệu | Hình thức | Lý do |
|---|---|---|---|
| Thật | Chấm tròn đặc | Nền trắng đặc, chữ tối | Đặc nhất, vì database vừa thực sự chạy ra. |
| Mô phỏng | Vòng tròn nửa đặc | Viền liền 1 px, không nền | Một nửa là tính toán, một nửa đã đối chiếu với database thật. |
| Ước lượng | Hai đường lượn | Viền đứt, chữ nghiêng | Ranh giới không chắc chắn, nhìn là biết đây là ngoại suy. |
| Chưa mô phỏng được | Vòng tròn gạch chéo | Viền đôi 3 px, cao hơn các nhãn khác | Đây là trạng thái dừng, không phải mức tin cậy. Khung viền đôi được dùng lại cho cả khối báo trạng thái ở vùng giữa. |

Trạng thái "Chưa mô phỏng được" không đưa ra số nào, và ghi rõ lý do. Tôi cố ý không dùng màu đỏ cho trạng thái này vì nó không phải là lỗi của người dùng.

## Font

| Vai trò | Font | Fallback | Lý do |
|---|---|---|---|
| Chữ giao diện | Public Sans 400, 500, 600, 700 | Segoe UI, system-ui, Roboto, Noto Sans | Có bộ ký tự tiếng Việt trên Google Fonts, dấu rõ ở 12 đến 14 px. |
| Mọi con số, SQL, khóa, tên cột, nhật ký | JetBrains Mono 400, 500, 700 | Cascadia Mono, Consolas, DejaVu Sans Mono, Noto Sans Mono | Chữ số đơn cách xếp thẳng hàng theo đúng yêu cầu của chủ dự án. Có đủ dấu tiếng Việt, cần vì nhật ký terminal là tiếng Việt. |

Tôi đã xem cả hai trường hợp: có webfont, và bản sao đã bỏ link Google Fonts. Cả hai đều hiện đúng dấu tiếng Việt trong Chrome trên Windows. Bộ kiểm tra của skill cảnh báo về font đơn cách, và tôi giữ lại vì đây là quyết định của phong cách. Chữ số và mã dùng font đơn cách, câu văn và nhãn thì không.

| Cỡ | Dùng cho |
|---|---|
| 12 px | Nhãn nhỏ, chú thích, nhãn kết luận, tick của thanh trượt |
| 12,5 px | Khóa và chữ bên trong cây SVG |
| 13 px | Thân bài trên máy tính, SQL, nhật ký, bảng kết quả |
| 14 px | Thân bài trên điện thoại, câu giải thích, tiêu đề rủi ro, số trong Capacity Advisor |

Không có chữ nào dưới 11 px. Tiêu đề `h1` là tên file ở 13 px, vì đây là màn hình để làm việc, không phải trang quảng bá. Kích thước tiếng Việt cần dòng cao hơn tiếng Anh do dấu, nên chiều cao dòng tối thiểu của thân bài là 19 đến 20 px.

## Khoảng cách

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--sp1` | 4 px | Khoảng hở nhỏ nhất, giữa số và đơn vị |
| `--sp2` | 8 px | Khoảng trong điều khiển |
| `--sp3` | 12 px | Khoảng trong thẻ |
| `--sp4` | 16 px | Khoảng trong của thẻ lớn |
| `--sp5` | 24 px | Khoảng giữa các thẻ bảng |
| `--edge` | 16 px | Lề trái và phải của mọi cột và panel, trên cả máy tính và điện thoại |
| `--h-top` | 44 px | Thanh trên cùng |
| `--h-bar` | 40 px | Thanh đầu mỗi vùng |
| `--radius` | 4 px | Bo góc của nút và thẻ. Nhãn dùng 2 px |

Skill tham khảo đề nghị nút bo tròn hoàn toàn, nhưng tôi dùng 4 px vì cảm giác chính xác của dụng cụ đo quan trọng hơn. Tôi cũng bỏ khoảng hở 24 px giữa các thẻ của skill, thay bằng đường kẻ 1 px giữa các vùng, vì bốn vùng cần tận dụng hết chiều ngang.

## Bố cục

Bố cục là ba cột cộng một panel dưới, theo lựa chọn của chủ dự án.

- Kích thước mặc định: cột SQL 320 px, cột rủi ro 348 px, terminal 180 px. Vùng giữa nhận phần còn lại, tức khoảng 770 px ở màn hình 1440 px.
- Bốn nút ở góc trên phải bật và tắt từng vùng. Vùng còn lại giãn ra lấp chỗ trống. Vùng cuối cùng còn bật thì nút của nó bị khóa, để màn hình không bao giờ trống.
- Kéo đường chia để đổi kích thước, trong khoảng 220 đến 560 px cho cột SQL, 260 đến 560 px cho cột rủi ro, 96 đến 480 px cho terminal. Đường chia đi được bằng phím mũi tên, Shift cộng mũi tên đi bước lớn, Home về mặc định, nhấp đúp cũng về mặc định.
- Từ 900 px trở xuống, màn hình chuyển thành bốn tab ở đáy. Từ 640 px trở xuống, cây và câu giải thích được ghép để cuộn chung, câu giải thích dính ở đáy để không bao giờ khuất.

Cách đánh dấu lựa chọn là một đường 1 px màu đèn đúng bằng chiều rộng nhãn, nằm trên cạnh gần nhất. Quy tắc này dùng chung cho engine, tab cảnh, tab terminal, ngôn ngữ, nút bật tắt và tab điện thoại.

## Điều học được từ hai trang tham khảo

Tôi đã chụp trang đầu của cả hai trang bằng Chrome thật và xem ảnh. Với drawsql.app, thứ tôi xem là ảnh sản phẩm trên trang chủ, không phải trình soạn thảo chạy thật.

- **database.build:** học cách chia khung phẳng, không đổ bóng, sơ đồ nằm trên nền tối một màu, và điểm neo tròn nhỏ ở hai đầu đường nối. Tôi không dùng lưới chấm ở nền vì bộ quy tắc của skill coi đây là dấu hiệu quen thuộc, và cây cần sự yên tĩnh.
- **drawsql.app:** học cách trình bày thẻ bảng: tên bảng ở đầu thẻ, tên cột bên trái, kiểu dữ liệu bên phải màu nhạt, khóa chính có ký hiệu riêng, đường nối đi vuông góc và chạm đúng dòng cột. Tôi không dùng màu theo nhóm bảng vì màu ở đây dành cho bằng chứng.

Tôi không sao chép logo, màu hay chữ của hai trang này.

## Cảnh B-Tree

- **Dựng:** SVG tự vẽ theo kích thước thật của vùng chứa, không co giãn bằng `viewBox`, nên chữ giữ nguyên cỡ ở mọi chiều rộng. Node nào không đủ chỗ sẽ gom vào cụm viền đứt, ghi rõ số node. Số trong cụm được tính từ tổng trang của từng tầng trừ đi số node đang hiện.
- **Chuyển động:** một timeline GSAP duy nhất, tua được hai chiều. Câu giải thích, nhật ký terminal, bộ đếm trang đều được suy ra từ vị trí timeline, nên tua lại thì tất cả cùng lùi theo. Key rơi bằng `power2.in` để có cảm giác trọng lực, nhảy sang heap bằng `back.in`. Chỉ animate transform, opacity và `stroke-dashoffset`.
- **Bốn trường hợp theo câu SQL:** tìm một key, quét một khoảng (trượt ngang qua các leaf), không dùng được index (cây tối đi và quét toàn bộ), và index không phải B-Tree (chưa mô phỏng được).
- **Khác biệt engine:** PostgreSQL nhảy từ index sang heap. MySQL vẽ hai cây, key rơi qua secondary rồi rơi lần hai qua clustered. Nhãn cũng đổi theo engine.
- **Thanh quy mô:** năm mức 10k, 100k, 500k, 1M, 10M. Cây tự thêm tầng, số liệu tính lại, và từ 1M trở lên nhãn đổi thành Ước lượng.
- **Giảm chuyển động:** khi hệ điều hành bật, cảnh không tự chạy, nút chạy bị ẩn, mỗi bước đổi ngay không có chuyển tiếp, và có một dòng báo rõ. Khi không bật, cảnh tự chạy một lần lúc mở file để chủ dự án thấy ngay ý tưởng.

## Công thức của dữ liệu minh họa

Mọi số được tính từ các hằng số trong file, không gõ tay, để các số ở nhiều chỗ luôn khớp nhau. Các hằng số này là minh họa, không phải số đo: độ rộng node 180 key, 64 dòng mỗi trang heap, trang 8 KB.

Với các hằng số này, số tầng ở 10k, 100k và 500k dòng khớp với kết quả đo level B-Tree trong `CLAUDE.md`. Các số còn lại như số trang và dung lượng thì không phải số đo. Nhãn Thật trong mẫu cho thấy cách sản phẩm sẽ gắn nhãn, và giao diện có ghi rõ điều này ở thanh trên và trong phần giả định.

## Quyết định tôi tự chọn

1. Cảnh tự chạy một lần khi mở file. Lý do: chủ dự án cần thấy ngay chuyển động. Sản phẩm thật có thể chỉ chạy khi người dùng bấm Chạy.
2. Khung B-Tree mang hai nhãn ở hai vị trí khi có cả hình cây và số liệu: một cho cây, một cho nhóm số liệu Capacity Advisor. Chúng thường trùng nhau, nhưng là hai kết luận khác nhau.
3. Nhật ký terminal ghi số thứ tự, không ghi giờ và không ghi thời gian chạy, và không chép lại nội dung SQL của người dùng, theo nguyên tắc số 3 và số 7.
4. Terminal được đặt nền tối như vùng giữa để hai vùng "máy đang chạy" trông cùng một họ.
5. Animation join chưa có trong mẫu, vì đề bài chỉ yêu cầu ba cảnh. Cây plan có ghi loại join.
6. Cây plan và sơ đồ bảng trong mẫu tự vẽ bằng HTML và SVG để file độc lập. Sản phẩm thật theo `CLAUDE.md` sẽ dùng Cytoscape.js và React Flow, nên Task005 chỉ nên lấy hình thức thẻ và đường nối.
7. Trình soạn thảo trong mẫu là ô văn bản thường, chưa tô màu cú pháp. Sản phẩm thật dùng CodeMirror 6.

## Kết quả tự đánh giá

Đây là phần tôi phê bình từ ảnh chụp sau vòng sửa cuối, theo câu hỏi của skill.

- **Câu hỏi của màn hình có được trả lời bằng khối lớn nhất không?** Có. Cây là khối lớn nhất, và con số đếm trang nằm ngay dưới cây.
- **Các khối có chung cạnh không?** Có. Các cột dùng chung lề 16 px, các số trong cột phải cùng kết thúc trên một đường.
- **Màu có nằm đúng trên dữ liệu không?** Có. Màu đèn chỉ nằm ở đường đi của key và đường chọn, màu đỏ chỉ nằm ở chữ "Hỏng".
- **Số có khớp không?** Có. Tổng 8.220 trang bằng 6 trang của Index Scan cộng 8.214 trang của Seq Scan, ở cả cây plan và cột rủi ro.
- **Còn yếu ở đâu:** khi key đi qua bước heap, các đường sáng hội tụ khá dày ở cửa sổ hẹp. Trên điện thoại, phần "Cuộc đua" nằm dưới màn hình đầu tiên và phải cuộn mới thấy. Hai cảnh phụ mới ở mức đủ để đánh giá hướng.
