import type { EngineId } from "@/contracts/engine";

// Mỗi mẫu chỉ dùng cú pháp của engine đó: serial/timestamptz ở PostgreSQL, AUTO_INCREMENT/DATETIME ở MySQL.
export const SAMPLE_SQL: Record<EngineId, string> = {
  postgres: `CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id int REFERENCES users (id),
  total int NOT NULL
);

CREATE INDEX idx_orders_user ON orders (user_id);

INSERT INTO users (email) SELECT 'user_' || g || '@example.com' FROM generate_series(1, 100) g;
INSERT INTO orders (user_id, total) SELECT (g % 100) + 1, g * 10 FROM generate_series(1, 300) g;

SELECT u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE lower(u.email) = 'user_1@example.com';
`,
  mysql: `CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users (email);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  total INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_orders_user ON orders (user_id);

INSERT INTO users (email) VALUES ('user_1@example.com'), ('user_2@example.com');
INSERT INTO orders (user_id, total) VALUES (1, 100), (2, 200);

SELECT u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE lower(u.email) = 'user_1@example.com';
`,
};
