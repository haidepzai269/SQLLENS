/**
 * Dự án mẫu dùng cho AC1 và AC3 của Task159.
 *
 * Tab chính có câu SQL khoảng 2 KB — độ dài thật của một câu phân tích mà người dùng
 * SQLLens hay dán, không phải chuỗi nhồi cho dài. Hai tab còn lại dựng bảng và nạp dữ liệu.
 */

export const PROJECT_NAME = "Phân tích đơn hàng theo khách";

// Tab 1: dựng schema. Đây cũng là thứ engine phải chạy để có dữ liệu thật.
export const TAB_SCHEMA = `CREATE TABLE customers (
  id          bigint PRIMARY KEY,
  name        text NOT NULL,
  region      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status      text NOT NULL,
  total       numeric(12,2) NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders(id),
  line_no     int NOT NULL,
  sku         text NOT NULL,
  qty         int NOT NULL,
  unit_price  numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

CREATE INDEX orders_customer_id_idx ON orders(customer_id);
CREATE INDEX orders_created_at_idx  ON orders(created_at);
CREATE INDEX orders_status_idx      ON orders(status);`;

// Tab 2: nạp dữ liệu (bản rút gọn để chạy được trong spike; số dòng do tham số quyết định).
export const TAB_SEED = (n: number) => `INSERT INTO customers
SELECT g, 'khach ' || g, (ARRAY['bac','trung','nam'])[g % 3 + 1], now() - (g || ' days')::interval
FROM generate_series(1, ${Math.max(1, Math.floor(n / 10))}) g;

INSERT INTO orders
SELECT g, (g % ${Math.max(1, Math.floor(n / 10))}) + 1,
       (ARRAY['new','paid','shipped','done'])[g % 4 + 1],
       (g % 100000) / 100.0,
       now() - (g || ' seconds')::interval
FROM generate_series(1, ${n}) g;

INSERT INTO order_items
SELECT (g % ${n}) + 1, (g % 3) + 1, 'sku-' || (g % 500), (g % 4) + 1, (g % 900) / 10.0
FROM generate_series(1, ${n * 3}) g;`;

/**
 * Tab 3: câu phân tích chính, khoảng 2 KB. Cố ý viết như người thật viết: có CTE,
 * window function, JOIN ba bảng, điều kiện thời gian, ORDER BY và LIMIT.
 */
export const TAB_MAIN = `-- Báo cáo: khách hàng đang chi nhiều nhất trong 30 ngày gần đây,
-- kèm số đơn, giá trị trung bình mỗi đơn và thứ hạng trong vùng của họ.
WITH recent_orders AS (
  SELECT
    o.id            AS order_id,
    o.customer_id,
    o.status,
    o.total,
    o.created_at,
    date_trunc('day', o.created_at) AS order_day
  FROM orders o
  WHERE o.created_at >= now() - interval '30 days'
    AND o.status <> 'new'
),
per_customer AS (
  SELECT
    r.customer_id,
    count(*)                          AS order_count,
    sum(r.total)                      AS revenue,
    avg(r.total)                      AS avg_order_value,
    max(r.created_at)                 AS last_order_at,
    count(DISTINCT r.order_day)       AS active_days
  FROM recent_orders r
  GROUP BY r.customer_id
),
item_rollup AS (
  SELECT
    o.customer_id,
    count(DISTINCT i.sku)             AS distinct_skus,
    sum(i.qty)                        AS total_qty,
    sum(i.qty * i.unit_price)         AS items_value
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  WHERE o.created_at >= now() - interval '30 days'
  GROUP BY o.customer_id
),
ranked AS (
  SELECT
    c.id                              AS customer_id,
    c.name,
    c.region,
    p.order_count,
    p.revenue,
    p.avg_order_value,
    p.active_days,
    p.last_order_at,
    coalesce(i.distinct_skus, 0)      AS distinct_skus,
    coalesce(i.total_qty, 0)          AS total_qty,
    rank() OVER (
      PARTITION BY c.region
      ORDER BY p.revenue DESC
    )                                 AS region_rank,
    sum(p.revenue) OVER (
      PARTITION BY c.region
    )                                 AS region_revenue,
    round(
      100.0 * p.revenue
      / nullif(sum(p.revenue) OVER (PARTITION BY c.region), 0),
      2
    )                                 AS region_share_pct
  FROM per_customer p
  JOIN customers c ON c.id = p.customer_id
  LEFT JOIN item_rollup i ON i.customer_id = c.id
  WHERE p.order_count >= 2
)
SELECT
  customer_id,
  name,
  region,
  order_count,
  revenue,
  avg_order_value,
  active_days,
  distinct_skus,
  total_qty,
  region_rank,
  region_revenue,
  region_share_pct
FROM ranked
WHERE region_rank <= 20
ORDER BY region, region_rank
LIMIT 100;`;

export const TABS = (n: number) => [
  { name: "01_schema.sql", sql: TAB_SCHEMA },
  { name: "02_seed.sql", sql: TAB_SEED(n) },
  { name: "03_report.sql", sql: TAB_MAIN },
];

/**
 * Câu truy vấn mà AC1/AC3 dùng để lấy plan thật và kết quả mẫu 100 dòng × 5 cột.
 * Đi qua index `orders_customer_id_idx` (AC3 đọc cây của chính index đó) và trả đúng
 * 100 dòng nên kết quả mẫu đúng hợp đồng AC1.
 */
export const PROBE_SQL =
  "SELECT id, customer_id, status, total, created_at FROM orders WHERE customer_id >= 42 ORDER BY customer_id, id LIMIT 100;";
