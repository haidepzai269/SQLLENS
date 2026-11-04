# Task055: Số liệu Capacity Advisor

Thuộc: SP010 / STR046
Mục tiêu: Đo số tầng, dung lượng và số trang đọc từ cây thật, rồi ngoại suy bằng công thức khi vượt 500k dòng, gắn đúng nhãn.
Phạm vi: `web/src/modules/what-if/capacity/**`, `web/messages/{vi,en}/capacity.json`.
Không làm: giao diện, sinh dữ liệu (dùng dữ liệu đã có trong bảng), QPS, độ trễ, sửa `web/src/engines/**` (nếu buộc phải sửa thì sửa tối thiểu và ghi vào bàn giao).

Hợp đồng, kiểu ở `web/src/contracts/whatif.ts`:
- `measureCapacity(adapter: Pick<EngineAdapter, "readBTree" | "explain" | "execute">, input: { index: string; table: string; probe?: string }): Promise<Outcome<CapacitySample>>`. Nhãn `real`. Dùng `readBTree` và `explain` có sẵn. Câu đếm dòng chạy với `internal: true`.
- `samplePoint(sample: CapacitySample): CapacityPoint`, `indexBytes` là số trang nhân 8192.
- `estimateCapacity(sample: CapacitySample, rows: number): Outcome<CapacityPoint>`. Nhãn `estimated`, chỉ nhận `rows` trên 500.000 và tối đa 1 tỷ. Từ 500.000 trở xuống trả `NotSimulated`, vì mức này phải đo thật.
- `readBTree` trả `NotSimulated` thì `measureCapacity` chuyển nguyên `reasonKey`.

Công thức: dùng `leafFanout` và `internalFanout` đo từ cây thật để tính số leaf, số trang từng tầng và số tầng. Số trang đọc khi ngoại suy lấy `pagesRead` đã đo cộng phần chênh số tầng. Không có `pagesRead` đo được thì để trống, không đoán. Cây chưa có tầng internal thì trả `NotSimulated`, vì chưa đo được độ rộng node.

Tiêu chí xong:
- AC1: Index `int` 100k dòng và 500k dòng: `height`, `indexPages` khớp `bt_metap` và `pg_relation_size` đọc trực tiếp trong test.
- AC2: Lấy mẫu ở 100k dòng, tính cho mức 500k rồi so với số đo thật ở 500k, trên cả index `int` và `text` hoặc `uuid`: số tầng đúng, `indexBytes` lệch không quá 15%.
- AC3: Đối chiếu trên Postgres 18 thật trong Docker (tên container `t055-*`, cổng 54550 trở lên, xóa khi xong): mẫu 500k, ngoại suy 5.000.000 dòng, so với index thật cùng cỡ. Số tầng đúng, `indexBytes` lệch không quá 15%. Ghi số đo vào bàn giao. Không đạt thì sửa công thức, không nới ngưỡng.
- AC4: `estimateCapacity` với 500.000 hoặc ít hơn, số âm, `NaN`, trên 1 tỷ, `leafFanout` bằng 0: trả `NotSimulated`.
- AC5: `evidence` của mẫu thật và kết quả ước lượng nêu rõ nguồn và điểm lấy mẫu. Toàn bộ kết quả không có trường thời gian, QPS, độ trễ.
- AC6: `npm run check` thoát 0.

Ca biên: index có `height` 1; bảng rỗng; `hidden` có dữ liệu khi cây lớn nên phải tính số leaf từ `hidden` và `nodes`, không chỉ từ các node đã đọc; `totalPages` có tính metapage hay không phải kiểm rồi ghi rõ.
Kiểm tra: `cd web && npm run check`; AC3. Không cần chạy Playwright.
Góc review thêm: nhãn kết luận, công thức có đúng với B-Tree thật không, test có đối chiếu thật hay chỉ so với chính công thức.
Đọc thêm: `CLAUDE.md` mục "Capacity Advisor"; `_bmad-output/SP008/STR033/Task039/ban_giao_task039.md`.
