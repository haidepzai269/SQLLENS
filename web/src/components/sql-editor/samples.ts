import type { EngineId } from "@/contracts/engine";

// Mỗi mẫu chỉ dùng cú pháp của engine đó: serial/timestamptz ở PostgreSQL, AUTO_INCREMENT/DATETIME ở MySQL.
export const SAMPLE_SQL: Record<EngineId, string> = {
  postgres: `CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);

INSERT INTO users (email) VALUES ('an@example.com'), ('binh@example.com');

SELECT id, email FROM users WHERE email = 'an@example.com';
`,
  mysql: `CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users (email);

INSERT INTO users (email) VALUES ('an@example.com'), ('binh@example.com');

SELECT id, email FROM users WHERE email = 'an@example.com';
`,
};
