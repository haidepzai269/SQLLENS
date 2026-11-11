import type { KnowledgeSnippet } from "./types";

export const KNOWLEDGE_CATALOG: readonly KnowledgeSnippet[] = [
  {
    tag: "RULE_SORT_DISK_SPILL",
    titleVi: "Tràn bộ nhớ sắp xếp ra đĩa (Sort Spill to Disk)",
    titleEn: "Sort Spill to Disk (work_mem Exhausted)",
    engine: "postgres",
    contextSummaryVi:
      "Khi khối lượng dữ liệu của mệnh đề ORDER BY hoặc DISTINCT vượt quá hạn mức tham số `work_mem` (mặc định 4MB), PostgreSQL chuyển thuật toán từ QuickSort/Top-N trong RAM sang External Merge Sort trên đĩa cứng. Hiện tượng này phát sinh I/O đĩa lớn, làm tăng thời gian chạy gấp nhiều lần. Khắc phục: tăng `work_mem` cục bộ trong phiên chạy (`SET work_mem = '64MB'`) hoặc tạo B-Tree index trùng thứ tự sắp xếp để thay thế Sort bằng Index Scan.",
    contextSummaryEn:
      "When sorted data for ORDER BY or DISTINCT exceeds PostgreSQL's `work_mem` setting (default 4MB), the engine switches from in-memory QuickSort/Top-N to an external merge sort on disk. This causes heavy disk I/O and latency spikes. Remedy: raise `work_mem` for the session (`SET work_mem = '64MB'`) or build a matching B-Tree index to eliminate the sort step via Index Scan.",
    sampleSqlBad: "SELECT * FROM orders ORDER BY created_at DESC;",
    sampleSqlGood: "CREATE INDEX idx_orders_created_at_desc ON orders(created_at DESC);",
  },
  {
    tag: "RULE_HASH_JOIN_SPILL",
    titleVi: "Hash Join tràn bộ nhớ sang nhiều Batch (Batches > 1)",
    titleEn: "Hash Join Memory Spill (Batches > 1)",
    engine: "postgres",
    contextSummaryVi:
      "Trong phép Hash Join, PostgreSQL dựng bảng băm (hash table) từ bảng bên trong (inner table) trong bộ nhớ `work_mem`. Nếu kích thước vượt quá `work_mem`, executor phải phân chia dữ liệu thành nhiều lô (batches > 1) và hoán đổi các bucket tạm xuống đĩa. Khắc phục: nâng `work_mem` của phiên, thêm điều kiện WHERE để thu hẹp dòng của bảng build, hoặc đánh index trên khóa nối để chuyển sang Merge Join hoặc Nested Loop.",
    contextSummaryEn:
      "During a Hash Join, PostgreSQL constructs an in-memory hash table for the inner relation within `work_mem`. If it overflows, the executor divides the table into multiple batches (Batches > 1) and swaps buckets to temporary disk files. Remedy: increase session `work_mem`, filter inner rows more selectively, or index join keys to allow efficient Merge Join or Nested Loop scans.",
    sampleSqlBad: "SELECT * FROM orders o JOIN line_items l ON o.id = l.order_id;",
    sampleSqlGood: "SET work_mem = '128MB'; -- hoặc tạo index trên khóa ngoại l.order_id",
  },
  {
    tag: "RULE_ACCIDENTAL_CARTESIAN",
    titleVi: "Tích Descartes vô ý (Missing JOIN Condition)",
    titleEn: "Accidental Cartesian Product (Unbounded JOIN)",
    engine: "both",
    contextSummaryVi:
      "Xảy ra khi câu lệnh nối bảng thiếu mệnh đề ON/WHERE ràng buộc khóa liên kết, hoặc điều kiện so sánh bị sai logic. Kết quả trả về bằng tích số dòng (M x N). Với các bảng chỉ vài nghìn dòng, kết quả bùng nổ lên hàng triệu bản ghi, làm cạn kiệt RAM, bão hòa CPU và có thể gây treo toàn bộ cụm cơ sở dữ liệu. Khắc phục: luôn kiểm tra điều kiện ON trên mọi phép JOIN.",
    contextSummaryEn:
      "Occurs when a JOIN lacks explicit ON/WHERE join conditions or contains flawed logic, generating an M x N Cartesian product. Even moderate tables balloon into millions of processed rows, exhausting RAM, saturating CPU, and threatening database availability. Remedy: ensure every JOIN specifies unambiguous matching predicates on key columns.",
    sampleSqlBad: "SELECT * FROM orders o, customers c WHERE o.total > 100;",
    sampleSqlGood: "SELECT * FROM orders o INNER JOIN customers c ON o.customer_id = c.id WHERE o.total > 100;",
  },
  {
    tag: "RULE_IMPLICIT_CAST_SCAN",
    titleVi: "Ép kiểu ngầm làm vô hiệu hóa B-Tree Index",
    titleEn: "Implicit Type Cast Disables B-Tree Index",
    engine: "both",
    contextSummaryVi:
      "Khi kiểu dữ liệu của hằng số tìm kiếm không trùng khớp với kiểu của cột (ví dụ cột `VARCHAR` nhưng so sánh với số nguyên `WHERE phone = 123456`), database buộc phải gọi hàm ép kiểu tự động (implicit CAST) lên từng dòng dữ liệu của bảng. Thao tác này khiến cây B-Tree index bị vô hiệu hóa hoàn toàn, đẩy truy vấn về Full Table Scan (Seq Scan). Khắc phục: truyền hằng số đúng kiểu của cột (đặt chuỗi trong nháy đơn) hoặc dùng Functional/Expression Index.",
    contextSummaryEn:
      "When the literal value type does not match the column type (e.g. comparing a `VARCHAR` column against an integer `WHERE phone = 12345`), the optimizer wraps the column in an implicit type-cast function row-by-row. This invalidates B-Tree index traversal and triggers a full table scan. Remedy: match the literal type with the column schema or define an expression index.",
    sampleSqlBad: "SELECT * FROM accounts WHERE phone_number = 987654321; -- phone_number là VARCHAR",
    sampleSqlGood: "SELECT * FROM accounts WHERE phone_number = '0987654321';",
  },
  {
    tag: "RULE_UNINDEXED_FK_DEADLOCK",
    titleVi: "Khóa bảng và Deadlock do thiếu Index trên Khóa Ngoại",
    titleEn: "Table Locks & Deadlocks from Unindexed Foreign Key",
    engine: "both",
    contextSummaryVi:
      "Khi bảng con có khóa ngoại (Foreign Key) nhưng cột này không được đánh chỉ mục B-Tree, mỗi thao tác UPDATE hoặc DELETE trên khóa chính bảng cha buộc engine phải quét toàn bộ bảng con để kiểm tra toàn vẹn tham chiếu. Việc này áp đặt khóa chia sẻ diện rộng trên bảng con, làm nghẽn các transaction ghi khác và là nguyên nhân hàng đầu gây Deadlock. Khắc phục: luôn đánh B-Tree index cho mọi cột Foreign Key ở bảng con.",
    contextSummaryEn:
      "When a foreign key column in a child table lacks a B-Tree index, any UPDATE or DELETE on the parent primary key forces the engine to perform a full scan of the child table to enforce referential integrity. This acquires broad shared locks, blocks concurrent writers, and frequently causes deadlocks. Remedy: always create a B-Tree index on all child foreign key columns.",
    sampleSqlBad: "CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT REFERENCES orders(id));",
    sampleSqlGood: "CREATE INDEX idx_order_items_order_id ON order_items(order_id);",
  },
  {
    tag: "RULE_MISSING_PRIMARY_KEY",
    titleVi: "Bảng thiếu Khóa Chính (Missing Primary Key)",
    titleEn: "Missing Primary Key",
    engine: "both",
    contextSummaryVi:
      "Bảng không có khóa chính vi phạm nguyên lý cơ bản của cơ sở dữ liệu quan hệ. Trong MySQL InnoDB, nếu thiếu Primary Key, engine phải tự sinh một khóa clustered ẩn 6-byte (`GEN_CLUST_INDEX`) dùng chung một mutex toàn cục trên toàn server, gây nghẽn cổ chai nghiêm trọng khi ghi đồng thời. Trong PostgreSQL, thiếu PK cản trở cập nhật/xóa có chọn lọc và không thể thiết lập Logical Replication. Khắc phục: luôn khai báo Primary Key rõ ràng.",
    contextSummaryEn:
      "A table without a primary key violates relational database design principles. In MySQL InnoDB, missing primary keys trigger an implicit 6-byte clustered key (`GEN_CLUST_INDEX`) protected by a shared global mutex, causing write bottlenecks. In PostgreSQL, missing PKs prevent row identification for logical replication and selective updates. Remedy: always define an explicit primary key.",
    sampleSqlBad: "CREATE TABLE activity_events (user_id INT, payload TEXT, created_at TIMESTAMP);",
    sampleSqlGood: "CREATE TABLE activity_events (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INT, payload TEXT, created_at TIMESTAMP);",
  },
  {
    tag: "RULE_LEADING_WILDCARD_LIKE",
    titleVi: "Tìm kiếm tiền tố bất định LIKE '%abc'",
    titleEn: "Leading Wildcard Pattern LIKE '%abc'",
    engine: "both",
    contextSummaryVi:
      "Cấu trúc B-Tree lưu trữ các khóa theo thứ tự từ điển từ trái qua phải. Toán tử so khớp có ký tự đại diện ở đầu (`LIKE '%abc'`) khiến engine không thể xác định điểm biên để tìm kiếm trong cây B-Tree (bỏ lỡ bước Index Seek), buộc phải quét tuần tự toàn bộ chỉ mục hoặc toàn bộ bảng. Khắc phục: nếu bài toán cho phép, đổi sang tìm kiếm tiền tố `LIKE 'abc%'`; nếu cần tìm kiếm chuỗi con bất kỳ, sử dụng `pg_trgm` (Postgres GIN index) hoặc MySQL Full-Text Search.",
    contextSummaryEn:
      "B-Tree indexes sort keys lexicographically from left to right. Predicates with a leading wildcard (`LIKE '%abc'`) prevent the engine from performing an index seek, degrading queries to full table or index scans. Remedy: use prefix matching (`LIKE 'abc%'`) where possible, or employ trigram indexes (`pg_trgm` GIN in PostgreSQL) or Full-Text Search in MySQL.",
    sampleSqlBad: "SELECT * FROM products WHERE name LIKE '%laptop%';",
    sampleSqlGood: "CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);",
  },
  {
    tag: "RULE_FUNCTION_ON_INDEX_COLUMN",
    titleVi: "Áp dụng hàm lên cột có Index trong mệnh đề WHERE",
    titleEn: "Wrapping Indexed Column in Function Call",
    engine: "both",
    contextSummaryVi:
      "Bọc hàm hoặc biểu thức tính toán quanh cột đã đánh index (như `WHERE DATE(created_at) = '2026-01-01'` hay `WHERE LOWER(email) = ...`) biến đổi giá trị cột trên từng dòng, ngăn engine so khớp trực tiếp với cây B-Tree sẵn có. Khắc phục: viết lại điều kiện truy vấn dạng đoạn (Sargable range query `WHERE created_at >= '...' AND created_at < '...'`) hoặc tạo Functional/Expression Index.",
    contextSummaryEn:
      "Wrapping an indexed column in scalar functions or arithmetic (e.g. `WHERE DATE(created_at) = '2026-01-01'` or `WHERE LOWER(email) = ...`) transforms values row-by-row, preventing direct B-Tree index seeks. Remedy: rewrite the predicate into a sargable range query (`WHERE created_at >= ... AND created_at < ...`) or define a functional/expression index.",
    sampleSqlBad: "SELECT * FROM users WHERE LOWER(email) = 'contact@sqllens.dev';",
    sampleSqlGood: "CREATE INDEX idx_users_lower_email ON users(LOWER(email));",
  },
  {
    tag: "RULE_FLOAT_FOR_CURRENCY",
    titleVi: "Sử dụng kiểu số thực (FLOAT/REAL) cho tiền tệ",
    titleEn: "Using Floating-Point Types for Financial Data",
    engine: "both",
    contextSummaryVi:
      "Các kiểu dữ liệu `FLOAT`, `REAL`, `DOUBLE PRECISION` biểu diễn số thập phân theo chuẩn nhị phân IEEE 754 mang tính xấp xỉ, dẫn đến sai số làm tròn khi thực hiện các phép tính cộng, trừ, nhân (ví dụ `0.1 + 0.2` thành `0.30000000000000004`). Trong ứng dụng tài chính và số dư tài khoản, sai số tích lũy gây lệch sổ cái và không vượt qua kiểm toán. Khắc phục: luôn dùng kiểu số có định dạng chính xác `NUMERIC(p, s)` / `DECIMAL(p, s)` hoặc lưu số nguyên theo đơn vị tiền tệ nhỏ nhất (đồng, cent).",
    contextSummaryEn:
      "`FLOAT` and `DOUBLE` types adhere to IEEE 754 binary floating-point specifications with approximate representations, causing rounding errors during arithmetic operations (e.g. `0.1 + 0.2 !== 0.3`). In financial systems, cumulative precision drift leads to ledger discrepancies and auditing failures. Remedy: always use fixed-point `NUMERIC(p, s)` / `DECIMAL(p, s)` or store atomic integer units (cents).",
    sampleSqlBad: "CREATE TABLE wallets (user_id INT, balance FLOAT NOT NULL);",
    sampleSqlGood: "CREATE TABLE wallets (user_id INT, balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00);",
  },
  {
    tag: "RULE_VARCHAR_OVERSIZED",
    titleVi: "Khai báo kích thước VARCHAR quá lớn (VARCHAR(65535))",
    titleEn: "Oversized VARCHAR Length Allocation",
    engine: "both",
    contextSummaryVi:
      "Mặc dù trên đĩa `VARCHAR(N)` chỉ lưu dung lượng thực tế của chuỗi kèm byte tiền tố độ dài, các bộ tối ưu hóa bộ nhớ tạm (như engine bảng tạm Memory trong MySQL hoặc bộ đệm sắp xếp) thường cấp phát bộ nhớ RAM cố định theo kích thước tối đa `N`. Khai báo `VARCHAR(65535)` khiến bộ đệm tràn nhanh chóng, ép bảng tạm xuống đĩa và gây nghẽn I/O. Khắc phục: định cỡ `VARCHAR` sát với nghiệp vụ thực tế (ví dụ `VARCHAR(100)` cho họ tên, `VARCHAR(255)` cho URL).",
    contextSummaryEn:
      "While on-disk `VARCHAR(N)` consumes only actual bytes plus length metadata, database query execution buffers (such as MySQL internal memory temporary tables and sort buffers) often allocate fixed memory based on the declared maximum `N`. Oversized definitions rapidly exhaust memory, spilling temp tables to disk and degrading throughput. Remedy: constrain column lengths to realistic business bounds (e.g. `VARCHAR(100)` for names, `VARCHAR(255)` for URLs).",
    sampleSqlBad: "CREATE TABLE profiles (username VARCHAR(65535), bio VARCHAR(65535));",
    sampleSqlGood: "CREATE TABLE profiles (username VARCHAR(50) NOT NULL, bio VARCHAR(2000));",
  },
  {
    tag: "RULE_NON_LEFTMOST_COMPOSITE",
    titleVi: "Vi phạm nguyên tắc tiền tố trái nhất (Leftmost Prefix)",
    titleEn: "Non-Leftmost Prefix on Composite Index",
    engine: "both",
    contextSummaryVi:
      "Chỉ mục kết hợp (Composite Index) trên `(colA, colB, colC)` được phân cấp sắp xếp bắt đầu từ `colA`. Nếu câu lệnh truy vấn chỉ lọc trên `colB` hoặc `colC` mà không có điều kiện ràng buộc trên `colA`, engine không thể tận dụng cây B-Tree để tìm kiếm trực tiếp (Index Seek) mà phải quét toàn bộ chỉ mục (Index Full Scan) hoặc quét toàn bảng. Khắc phục: sắp xếp các cột trong chỉ mục theo thứ tự từ cột hay lọc nhất đến ít lọc hơn, hoặc tạo thêm chỉ mục riêng cho `colB`.",
    contextSummaryEn:
      "A composite index on `(colA, colB, colC)` orders entries hierarchically beginning with `colA`. If a query filters solely on `colB` or `colC` without constraining `colA`, the optimizer cannot perform an index seek and falls back to a full index scan or full table scan. Remedy: organize composite indexes with the most selective leading columns or create a dedicated secondary index.",
    sampleSqlBad: "-- Có index (store_id, status) nhưng truy vấn:\nSELECT * FROM orders WHERE status = 'PENDING';",
    sampleSqlGood: "-- Thêm store_id vào WHERE hoặc tạo index riêng cho status:\nSELECT * FROM orders WHERE store_id = 10 AND status = 'PENDING';",
  },
  {
    tag: "RULE_MYSQL_GAP_LOCK_NEXTKEY",
    titleVi: "Khóa khoảng cách và Next-Key Lock trong MySQL InnoDB",
    titleEn: "MySQL InnoDB Gap Locks & Next-Key Locks",
    engine: "mysql",
    contextSummaryVi:
      "Trong mức cô lập `REPEATABLE READ` mặc định của MySQL InnoDB, cơ chế Next-Key Locking kết hợp khóa bản ghi (Record Lock) và khóa khoảng trống giữa các bản ghi (Gap Lock) để triệt tiêu hiện tượng đọc bóng ma (Phantom Read). Khi thực hiện `UPDATE/DELETE` hoặc `SELECT ... FOR UPDATE` trên cột không có Unique Index, InnoDB khóa toàn bộ khoảng trống xung quanh, làm treo mọi lệnh INSERT đồng thời vào vùng đó và rất dễ dẫn đến Deadlock. Khắc phục: truy vấn theo khóa chính hoặc Unique Index, giữ transaction ngắn nhất có thể, hoặc cân nhắc mức cô lập `READ COMMITTED`.",
    contextSummaryEn:
      "Under MySQL InnoDB's default `REPEATABLE READ` isolation level, Next-Key Locking merges record locks with gap locks to eliminate phantom reads. When executing `UPDATE/DELETE` or `SELECT ... FOR UPDATE` over non-unique index ranges, InnoDB locks entire interval gaps, blocking concurrent inserts and provoking deadlocks. Remedy: target unique indexes or primary keys, minimize transaction duration, or switch to `READ COMMITTED` isolation if applicable.",
    sampleSqlBad: "SELECT * FROM inventory WHERE category_id = 4 FOR UPDATE; -- category_id không có unique index",
    sampleSqlGood: "SELECT * FROM inventory WHERE id = 1001 FOR UPDATE; -- tìm kiếm theo khóa chính chỉ khóa 1 record lock",
  },
  {
    tag: "RULE_MYSQL_FILESORT",
    titleVi: "MySQL Filesort khi thiếu Composite Index sắp xếp",
    titleEn: "MySQL Using Filesort on ORDER BY Queries",
    engine: "mysql",
    contextSummaryVi:
      "Trong MySQL `EXPLAIN`, chỉ báo `Using filesort` thể hiện rằng engine không thể đọc dữ liệu theo đúng thứ tự sắp xếp từ chỉ mục, mà phải nạp các dòng kết quả vào bộ đệm `sort_buffer` để sắp xếp lại. Khi kích thước dữ liệu vượt quá `sort_buffer_size`, MySQL phân mảnh và ghi tạm ra các file trên đĩa. Khắc phục: tạo chỉ mục kết hợp bao gồm cả các cột trong `WHERE` và các cột trong `ORDER BY` theo đúng thứ tự (`(status, created_at DESC)`).",
    contextSummaryEn:
      "In MySQL `EXPLAIN`, `Using filesort` indicates the optimizer cannot retrieve rows in the desired order from an index, requiring an extra sorting phase in `sort_buffer`. If the sort volume exceeds `sort_buffer_size`, it spills to temporary disk files. Remedy: create a composite index covering both WHERE and ORDER BY columns in identical order (`(status, created_at DESC)`).",
    sampleSqlBad: "SELECT * FROM articles WHERE status = 'published' ORDER BY created_at DESC; -- chỉ có index trên status",
    sampleSqlGood: "CREATE INDEX idx_articles_status_created ON articles(status, created_at DESC);",
  },
  {
    tag: "RULE_POSTGRES_TOAST_OVERHEAD",
    titleVi: "Tắc nghẽn I/O do cơ chế lưu trữ TOAST trong PostgreSQL",
    titleEn: "PostgreSQL TOAST Overhead on Bulky Columns",
    engine: "postgres",
    contextSummaryVi:
      "PostgreSQL có kích cỡ trang dữ liệu cố định 8KB. Bất kỳ giá trị cột nào vượt quá ngưỡng ~2KB (như văn bản dài `TEXT`, `JSONB`, `BYTEA`) sẽ tự động được nén và lưu trữ ngoài dòng tại bảng TOAST riêng biệt. Truy vấn `SELECT *` buộc engine phải đọc bảng chính rồi giải nén từng trang TOAST tương ứng, tiêu tốn lượng lớn I/O đĩa. Khắc phục: tránh dùng `SELECT *`, chỉ chọn các cột cần thiết hoặc tách các trường văn bản lớn sang bảng phụ.",
    contextSummaryEn:
      "PostgreSQL uses a fixed 8KB page size. Column attributes exceeding ~2KB (such as large `TEXT`, `JSONB`, or `BYTEA`) are compressed and relocated out-of-line into dedicated TOAST tables. Running `SELECT *` forces the executor to decompress out-of-line TOAST pointers, severely multiplying I/O consumption. Remedy: avoid `SELECT *`, project only necessary columns, or isolate large payloads into auxiliary tables.",
    sampleSqlBad: "SELECT * FROM blog_posts WHERE status = 'published'; -- kéo theo cột full_content_html nặng 500KB",
    sampleSqlGood: "SELECT id, title, slug, published_at FROM blog_posts WHERE status = 'published';",
  },
  {
    tag: "RULE_COUNT_STAR_BIG_TABLE",
    titleVi: "Quét toàn bảng khi chạy COUNT(*) trên bảng lớn",
    titleEn: "Slow COUNT(*) on Large Tables Due to MVCC",
    engine: "both",
    contextSummaryVi:
      "Do cơ chế MVCC (Multi-Version Concurrency Control), mỗi transaction nhìn thấy một ảnh chụp (snapshot) dữ liệu độc lập, khiến database không thể lưu sẵn một con số tổng `count` tức thì. Lệnh `COUNT(*)` buộc phải quét toàn bộ bảng hoặc toàn bộ chỉ mục để kiểm tra tính hiển thị của từng dòng dữ liệu. Trên các bảng hàng triệu dòng, truy vấn này mất nhiều giây. Khắc phục: sử dụng thống kê ước tính (`reltuples` trong `pg_class` hoặc `TABLE_ROWS` trong MySQL) cho màn hình hiển thị, hoặc duy trì bảng đếm riêng bằng trigger/cronjob.",
    contextSummaryEn:
      "Due to MVCC visibility constraints, each transaction operates on an isolated snapshot, preventing engines like PostgreSQL from caching global row totals. `COUNT(*)` must scan the entire table or index to evaluate tuple visibility. On multi-million row tables, this takes seconds. Remedy: use fast catalog estimates (`pg_class.reltuples` or MySQL `TABLE_ROWS`) for analytical displays, or maintain counter summary tables via triggers.",
    sampleSqlBad: "SELECT COUNT(*) FROM audit_events; -- quét toàn bộ 20 triệu dòng",
    sampleSqlGood: "SELECT reltuples::BIGINT AS estimate FROM pg_class WHERE relname = 'audit_events';",
  },
];

export const KNOWLEDGE_BY_TAG: ReadonlyMap<string, KnowledgeSnippet> = new Map(
  KNOWLEDGE_CATALOG.map((item) => [item.tag, item])
);
