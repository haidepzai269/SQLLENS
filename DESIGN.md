---
name: SQLLens
description: Phòng lab tối cho database. Một màu đèn duy nhất chiếu vào chỗ đang đọc, mọi thứ khác nằm trong bóng.
colors:
  stage: '#0e0e10'
  ground: '#171719'
  surface: '#131217'
  raised: '#212023'
  rule: '#1f1e23'
  line: '#2a2a2e'
  control: '#3a3a3e'
  canvas-dot: '#34343a'
  text: '#ffffff'
  ink2: '#c4c5c9'
  dim: '#92949a'
  lamp: '#f2b84b'
  lamp-ink: '#17130a'
  negative: '#ef6b82'
  label-real: '#ffffff'
  label-real-foreground: '#131217'
  label-simulated: '#c4c5c9'
  label-estimated: '#c4c5c9'
  label-unsimulated: '#c4c5c9'
  severity-broken: '#ef6b82'
  severity-broken-bg: '#2a161c'
  severity-broken-foreground: '#ff9fae'
  severity-passed: '#4fb08e'
  severity-passed-bg: '#12261f'
  severity-passed-foreground: '#86dcbd'
  severity-uncertain: '#d8dc52'
  severity-uncertain-bg: '#24260e'
  severity-uncertain-foreground: '#e6ea78'
typography:
  body: { fontFamily: Public Sans, fontSize: 13px, fontWeight: 400, lineHeight: 20px }
  body-mobile: { fontFamily: Public Sans, fontSize: 14px, fontWeight: 400, lineHeight: 20px }
  small: { fontFamily: Public Sans, fontSize: 12px, fontWeight: 500, lineHeight: 16px }
  data: { fontFamily: JetBrains Mono, fontSize: 13px, fontWeight: 400, lineHeight: 20px }
  tree: { fontFamily: JetBrains Mono, fontSize: 12.5px, fontWeight: 500 }
rounded: { DEFAULT: 4px, label: 2px }
spacing: { '1': 4px, '2': 8px, '3': 12px, '4': 16px, '5': 24px, edge: 16px, h-top: 44px, h-bar: 40px }
---

# DESIGN.md: SQLLens

Nguồn: mẫu đã duyệt ở `_bmad-output/SP001/STR002/Task004/` (`mau_giao_dien.html`, `ghi_chu_thiet_ke.md`). Token nằm ở `web/src/app/globals.css`. Mỗi màu ở đây có một biến CSS cùng tên (`--stage`, `--lamp`...), và `web/src/app/tokens.test.ts` kiểm tra điều đó.

## Brand & Style

Màn hình để làm việc, không phải trang quảng bá. Nền tối như bàn soi trong phòng lab, phẳng, không gradient, không glow, không glass, không đổ bóng. Lớp được tách bằng bậc sáng và đường 1 px. Bo góc 4 px.

Ý tưởng chính: key đang được soi là thứ duy nhất được chiếu sáng. Cả sản phẩm chỉ có một màu đèn.

Giao diện chính là tối. Chưa có giao diện sáng. `.dark` trùng `:root` để biến thể `dark:` của shadcn/ui hoạt động.

## Colors

Bề mặt, từ tối nhất đến sáng nhất:

| Token | Giá trị | Dùng cho |
|---|---|---|
| `stage` | `#0e0e10` | Vùng mô phỏng, terminal. Tối nhất, mắt vào đây trước |
| `ground` | `#171719` | Nền trang, thanh trên (`--background`) |
| `surface` | `#131217` | Cột SQL, cột rủi ro, thẻ node, thẻ bảng (`--card`) |
| `raised` | `#212023` | Dòng đang chọn, rãnh thanh số liệu, hover (`--secondary`, `--muted`, `--accent`) |
| `rule` | `#1f1e23` | Đường kẻ giữa các dòng trong danh sách và bảng |
| `line` | `#2a2a2e` | Đường chia các vùng (`--border`) |
| `control` | `#3a3a3e` | Viền node, viền nút phụ, nhánh chưa đi qua (`--input`) |
| `canvas-dot` | `#34343a` | Chấm lưới canvas, 1 px, ô 24 px |

Chữ:

| Token | Giá trị | Dùng cho |
|---|---|---|
| `text` | `#ffffff` | Chữ chính, số liệu chính (`--foreground`) |
| `ink2` | `#c4c5c9` | Chữ phụ, nội dung SQL, khóa trong node |
| `dim` | `#92949a` | Nhãn nhỏ, chú thích, số dòng (`--muted-foreground`) |

Màu nhấn:

| Token | Giá trị | Dùng cho |
|---|---|---|
| `lamp` | `#f2b84b` | Đường đi của key, key, trang đang đọc, đường chọn 1 px, viền focus (`--primary`, `--ring`) |
| `lamp-ink` | `#17130a` | Chữ trên nền đèn (`--primary-foreground`) |
| `negative` | `#ef6b82` | Chữ "Hỏng ở bước N", cột thiếu index (`--destructive`). Luôn đi kèm chữ |

Màu đèn nghĩa là "chỗ đang đọc hoặc đang chọn". Không dùng làm màu trang trí, không dùng cho mức độ.

Tên biến khác mẫu ở hai chỗ: `--muted` của mẫu (màu chữ) thành `dim`, `--border` của mẫu thành `line`, vì `--muted` và `--border` là tên shadcn/ui với nghĩa khác (nền, viền).

### Nhãn kết luận

Mỗi kết luận mang đúng một nhãn. Nhãn phân biệt bằng chữ, ký hiệu, kiểu nền và kiểu viền cùng lúc, nên đọc được cả khi không thấy màu. Chữ nhãn luôn là `text` (`#ffffff`) trên nền tối, riêng nhãn Thật là chữ `label-real-foreground` trên nền `label-real`.

| Nhãn | Token | Ký hiệu | Hình thức |
|---|---|---|---|
| Thật | `label-real`, `label-real-foreground` | Chấm tròn đặc | Nền đặc, chữ tối |
| Mô phỏng | `label-simulated` | Vòng tròn nửa đặc | Viền liền 1 px, không nền |
| Ước lượng | `label-estimated` | Hai đường lượn | Viền đứt 1 px, chữ nghiêng |
| Chưa mô phỏng được | `label-unsimulated` | Vòng tròn gạch chéo | Viền đôi 3 px, cao 24 px (các nhãn khác 20 px). Không dùng màu đỏ, vì đây không phải lỗi của người dùng |

Chiều cao nhãn 20 px, chữ 12 px, lề ngang 7 px, bo 2 px. Nhãn Chưa mô phỏng được không kèm số nào, chỉ kèm lý do.

### Màu mức độ ở cột rủi ro

Mức độ nói thẻ cần được chú ý thế nào. Nhãn nói số đến từ đâu. Hai thứ độc lập: mỗi thẻ có một mức độ và một nhãn.

| Mức | Token viền, nền, chữ | Ký hiệu | Câu chữ |
|---|---|---|---|
| Hỏng | `severity-broken` `#ef6b82`, `severity-broken-bg` `#2a161c`, `severity-broken-foreground` `#ff9fae` | Ô vuông đặc có dấu nhân | "Hỏng ở bước N" |
| Không hỏng | `severity-passed` `#4fb08e`, `severity-passed-bg` `#12261f`, `severity-passed-foreground` `#86dcbd` | Vòng tròn có gạch ngang | "Không hỏng qua N bước, ở kịch bản và giả định này" |
| Cần xem lại | `severity-uncertain` `#d8dc52`, `severity-uncertain-bg` `#24260e`, `severity-uncertain-foreground` `#e6ea78` | Tam giác có dấu chấm than | "Cần xem lại: ..." (Ước lượng hoặc Chưa mô phỏng được) |

Quy tắc:

- Màu không bao giờ đứng một mình: luôn có ký hiệu khác hình và câu chữ.
- Màu xanh không dùng dấu tích, và câu chữ luôn nêu phạm vi (kịch bản, giả định). Không bao giờ nói "thiết kế này ổn".
- Vàng mức độ (`#d8dc52`, ngả xanh lục) phải khác màu đèn (`#f2b84b`, ngả cam). Khoảng cách màu CIE76 đo ở mẫu là 29,9. Vàng luôn là cả thẻ có viền, nền, tam giác và chữ. Màu đèn chỉ là đường 1 px hoặc khối nhỏ trên dữ liệu. Chủ dự án nên nhìn lại hai màu ấm này trên màn hình thật.
- Viền thẻ 1 px màu mức độ, nền nhẹ, tiêu đề và số dùng `text`, đoạn văn dùng `ink2`.

### Đo tương phản (AC2)

Tính theo công thức WCAG 2.x từ giá trị trong `globals.css`. Chữ thường cần tối thiểu 4,5:1. `tokens.test.ts` chạy lại các cặp chữ dưới đây và trượt nếu cặp nào dưới 4,5:1.

| Chữ | Nền | Tỷ lệ | Đạt 4,5:1 |
|---|---|---:|---|
| `text` | `ground` | 17,90 | Có |
| `ink2` | `ground` | 10,38 | Có |
| `dim` | `ground` | 5,90 | Có |
| `text` | `stage` | 19,28 | Có |
| `ink2` | `stage` | 11,18 | Có |
| `dim` | `stage` | 6,36 | Có |
| `text` | `surface` | 18,64 | Có |
| `ink2` | `surface` | 10,81 | Có |
| `dim` | `surface` | 6,15 | Có |
| `text` | `raised` | 16,21 | Có |
| `ink2` | `raised` | 9,40 | Có |
| `dim` | `raised` | 5,35 | Có |
| `lamp-ink` | `lamp` | 10,35 | Có |
| `label-real-foreground` | `label-real` | 18,64 | Có |
| `negative` | `surface` | 6,30 | Có |
| `negative` | `stage` | 6,52 | Có |
| `severity-broken-foreground` | `severity-broken-bg` | 8,80 | Có |
| `text` | `severity-broken-bg` | 17,07 | Có |
| `ink2` | `severity-broken-bg` | 9,90 | Có |
| `severity-passed-foreground` | `severity-passed-bg` | 9,82 | Có |
| `text` | `severity-passed-bg` | 15,88 | Có |
| `ink2` | `severity-passed-bg` | 9,21 | Có |
| `severity-uncertain-foreground` | `severity-uncertain-bg` | 12,07 | Có |
| `text` | `severity-uncertain-bg` | 15,46 | Có |
| `ink2` | `severity-uncertain-bg` | 8,96 | Có |

Phần tử không phải chữ:

| Cặp | Tỷ lệ | Ghi chú |
|---|---:|---|
| `lamp` trên `surface` | 10,41 | Viền focus và đường chọn, cần 3:1. Đạt |
| `lamp` trên `stage` | 10,77 | Đường đi của key. Đạt |
| `control` trên `stage` | 1,70 | Viền node và nhánh chưa đi qua. Dưới 3:1 |
| `line` trên `ground` | 1,25 | Đường chia vùng, chỉ trang trí |

Hai dòng cuối không đạt 3:1 của WCAG 1.4.11 và được giữ đúng như mẫu đã duyệt. Nút và ô nhập phải có chữ hoặc ký hiệu đạt 4,5:1 để nhận ra, không chỉ dựa vào viền `control`.

## Typography

| Vai trò | Font | Fallback |
|---|---|---|
| Chữ giao diện | Public Sans 400, 500, 600, 700 | Segoe UI, system-ui, Roboto, Noto Sans |
| Số, SQL, khóa, tên cột, nhật ký | JetBrains Mono 400, 500, 700 | Cascadia Mono, Consolas, DejaVu Sans Mono, Noto Sans Mono |

Cả hai có đủ dấu tiếng Việt. Biến `--sans` và `--mono` trong `globals.css` chỉ khai báo danh sách font. Việc nạp webfont thuộc khung ứng dụng (task sau). Trước đó trình duyệt dùng fallback.

| Cỡ | Dùng cho |
|---|---|
| 12 px | Nhãn nhỏ, chú thích, nhãn kết luận, tick thanh trượt |
| 12,5 px | Khóa và chữ trong cây SVG |
| 13 px | Thân bài trên máy tính, SQL, nhật ký, bảng kết quả |
| 14 px | Thân bài trên điện thoại, câu giải thích, tiêu đề rủi ro, số trong Capacity Advisor |

Quy tắc: không chữ nào dưới 11 px. Chiều cao dòng thân bài tối thiểu 19 đến 20 px vì dấu tiếng Việt. Số luôn dùng chữ số đơn cách (`font-variant-numeric: tabular-nums` đã đặt ở `body`). `h1` là tên file ở 13 px. Câu văn và nhãn không dùng font đơn cách.

## Layout & Spacing

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--sp1` | 4 px | Giữa số và đơn vị |
| `--sp2` | 8 px | Trong điều khiển |
| `--sp3` | 12 px | Trong thẻ |
| `--sp4` | 16 px | Trong thẻ lớn |
| `--sp5` | 24 px | Giữa các thẻ bảng |
| `--edge` | 16 px | Lề trái và phải của mọi cột và panel, cả máy tính và điện thoại |
| `--h-top` | 44 px | Thanh trên cùng |
| `--h-bar` | 40 px | Thanh đầu mỗi vùng |

Bố cục ba cột cộng panel dưới. Kích thước mặc định 320 px (SQL), 348 px (rủi ro), 180 px (terminal). Chi tiết hành vi ở `EXPERIENCE.md`. Các vùng ngăn cách bằng đường 1 px `line`, không có khoảng hở.

Đánh dấu lựa chọn: một đường 1 px `lamp` đúng bằng chiều rộng nhãn, nằm trên cạnh gần nhất. Dùng chung cho engine, tab cảnh, tab terminal, ngôn ngữ, nút bật tắt và tab điện thoại.

Điểm ngắt: 900 px (bốn tab ở đáy), 640 px (cây và câu giải thích cuộn chung), 560 px (canvas một cột).

## Elevation & Depth

Không đổ bóng. Các bậc nền `stage`, `ground`, `surface`, `raised` tạo chiều sâu. Menu nổi (popover, dropdown) dùng `surface` và viền `line`.

## Shapes

Bo góc 4 px (`--radius`) cho nút và thẻ. Nhãn kết luận 2 px. Không có nút bo tròn hoàn toàn. Các bậc `--radius-md` và `--radius-lg` của shadcn/ui suy ra từ `--radius`.

## Animation

- Animation chạy khi người dùng bấm Chạy. Chỉ landing page được tự chạy (xem `EXPERIENCE.md`).
- GSAP cho cây B-Tree: một timeline duy nhất, tua được hai chiều. Văn bản giải thích, nhật ký và bộ đếm trang suy ra từ vị trí timeline.
- Chỉ animate `transform`, `opacity` và `stroke-dashoffset`.
- Key rơi bằng `power2.in` (trọng lực), nhảy sang heap bằng `back.in`.
- Màu đèn là thứ duy nhất sáng lên khi chạy. Nhánh chưa đi qua giữ `control`. Query không dùng được index thì cây tối đi.
- Kéo và zoom canvas là thao tác trực tiếp, không có chuyển tiếp.
- `prefers-reduced-motion: reduce`: cảnh không tự chạy, mỗi bước đổi ngay, không chuyển tiếp, có một dòng báo rõ. `globals.css` đã tắt `transition` và `scroll-behavior`.

## Components

- Dùng component shadcn/ui đã cài. `--primary` là màu đèn, nên nút chính của shadcn là nút đèn. Mỗi màn hình tối đa một nút chính (Chạy).
- Cây B-Tree, hình mô phỏng, nhãn kết luận và thẻ mức độ tự vẽ vì shadcn không có. Sơ đồ bảng và cây plan dùng React Flow với thẻ shadcn/ui. Đồ thị chờ khóa dùng Cytoscape.js.
- Thẻ node trên React Flow: nền `surface`, viền `control`, bo 4 px, tên ở đầu, kiểu dữ liệu bên phải màu `dim`. Đường nối vuông góc. Cạnh nối với thẻ đang kéo đổi sang `lamp`.
- Lưới canvas: chấm 1 px `canvas-dot`, ô 24 px, co giãn theo zoom, vẽ bằng ảnh SVG nhúng. Cây ở chế độ "Cố định" để nền trơn.
- Focus: `outline: 2px solid var(--lamp); outline-offset: 1px`, đặt toàn cục.

## Do's and Don'ts

Nên:
- Dùng đúng một nhãn cho mỗi kết luận, kèm ký hiệu và chữ.
- Ghi mức độ bằng ký hiệu, chữ và màu cùng lúc.
- Dùng token, không viết màu hex trong component.

Không nên:
- Dùng màu đèn cho mức độ hoặc để trang trí.
- Dùng màu đỏ cho trạng thái Chưa mô phỏng được.
- Dùng dấu tích hoặc câu hàm ý "thiết kế này ổn".
- Dùng gradient, glow, glass, bóng đổ, bo tròn hoàn toàn.
- Chỉ dùng màu để phân biệt hai trạng thái.
- Hiển thị thời gian chạy trong sandbox như dự đoán cho production.
