// Package store lưu tài khoản và phiên đăng nhập của app trên Postgres.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/haidepzai269/SQLLENS/api/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("store: not found")

type Profile struct {
	DisplayName string
	Email       string // rỗng nếu nhà cung cấp không trả
	AvatarURL   string
}

type User struct {
	ID          string
	DisplayName string
	Email       string
	AvatarURL   string
	CreatedAt   time.Time
}

type Store struct{ pool *pgxpool.Pool }

// Open tạo pool nhỏ để Neon tự tắt được, rồi ping để lỗi kết nối hiện ngay.
func Open(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		// Không đưa err vào thông báo: URL có thể chứa mật khẩu.
		return nil, errors.New("store: DATABASE_URL không hợp lệ")
	}
	cfg.MaxConns = 4
	cfg.MinConns = 0
	cfg.MaxConnIdleTime = 30 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: tạo pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: không kết nối được database: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

// Migrate chạy các file chưa có trong schema_migrations. Khóa advisory để nhiều instance không chạy đua.
func (s *Store) Migrate(ctx context.Context) error {
	files, err := migrations.FS.ReadDir(".")
	if err != nil {
		return err
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("store: migrate: %w", err)
	}
	defer conn.Release()
	const lockKey = 41041
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return fmt.Errorf("store: migrate lock: %w", err)
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockKey) }()
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("store: migrate: %w", err)
	}
	for _, f := range files { // ReadDir đã sắp theo tên
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".sql") {
			continue
		}
		var done bool
		if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, f.Name()).Scan(&done); err != nil {
			return fmt.Errorf("store: migrate %s: %w", f.Name(), err)
		}
		if done {
			continue
		}
		body, err := migrations.FS.ReadFile(f.Name())
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		// Exec không tham số dùng simple protocol nên chạy được file nhiều câu lệnh.
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("store: migrate %s: %w", f.Name(), err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, f.Name()); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("store: migrate %s: %w", f.Name(), err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("store: migrate %s: %w", f.Name(), err)
		}
	}
	return nil
}

func clean(s string) string {
	return strings.ReplaceAll(strings.ToValidUTF8(s, "�"), "\x00", "") // Postgres từ chối NUL
}

func nullable(s string) *string {
	if s = clean(s); s == "" {
		return nil
	}
	return &s
}

const userCols = `u.id::text, u.display_name, COALESCE(u.email, ''), COALESCE(u.avatar_url, ''), u.created_at`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.DisplayName, &u.Email, &u.AvatarURL, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// UpsertIdentity tìm hoặc tạo user theo (provider, subject). Không gộp theo email.
// Khóa advisory theo cặp (provider, subject) để hai lời gọi đồng thời không tạo hai user.
func (s *Store) UpsertIdentity(ctx context.Context, provider, subject string, p Profile) (User, error) {
	if provider != "google" && provider != "github" {
		return User{}, fmt.Errorf("store: nhà cung cấp không hợp lệ %q", provider)
	}
	if subject == "" {
		return User{}, errors.New("store: thiếu mã người dùng của nhà cung cấp")
	}
	name := clean(p.DisplayName)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, provider+":"+subject); err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	var id string
	err = tx.QueryRow(ctx, `SELECT user_id::text FROM identities WHERE provider = $1 AND subject = $2`, provider, subject).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if err := tx.QueryRow(ctx, `INSERT INTO users (display_name, email, avatar_url) VALUES ($1, $2, $3) RETURNING id::text`,
			name, nullable(p.Email), nullable(p.AvatarURL)).Scan(&id); err != nil {
			return User{}, fmt.Errorf("store: upsert: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO identities (provider, subject, user_id) VALUES ($1, $2, $3)`, provider, subject, id); err != nil {
			return User{}, fmt.Errorf("store: upsert: %w", err)
		}
	case err != nil:
		return User{}, fmt.Errorf("store: upsert: %w", err)
	default:
		if _, err := tx.Exec(ctx, `UPDATE users SET display_name = $2, email = $3, avatar_url = $4 WHERE id = $1`,
			id, name, nullable(p.Email), nullable(p.AvatarURL)); err != nil {
			return User{}, fmt.Errorf("store: upsert: %w", err)
		}
	}
	u, err := scanUser(tx.QueryRow(ctx, `SELECT `+userCols+` FROM users u WHERE u.id = $1`, id))
	if err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	return u, nil
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// CreateSession trả token 32 byte ngẫu nhiên (base64url). Database chỉ giữ băm SHA-256.
func (s *Store) CreateSession(ctx context.Context, userID string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", errors.New("store: ttl phải dương")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("store: tạo token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if _, err := s.pool.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)`,
		hashToken(token), userID, fmt.Sprintf("%d microseconds", ttl.Microseconds())); err != nil {
		return "", fmt.Errorf("store: tạo phiên: %w", err)
	}
	return token, nil
}

// SessionUser trả user của phiên còn hạn và cập nhật lần dùng cuối. Token sai hoặc hết hạn: ErrNotFound.
func (s *Store) SessionUser(ctx context.Context, token string) (User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, `WITH s AS (
		UPDATE sessions SET last_used_at = now() WHERE token_hash = $1 AND expires_at > now() RETURNING user_id)
		SELECT `+userCols+` FROM users u JOIN s ON s.user_id = u.id`, hashToken(token)))
	if err != nil && !errors.Is(err, ErrNotFound) {
		return User{}, fmt.Errorf("store: tra phiên: %w", err)
	}
	return u, err
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, hashToken(token)); err != nil {
		return fmt.Errorf("store: xóa phiên: %w", err)
	}
	return nil
}

func (s *Store) DeleteExpired(ctx context.Context) (int, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= now()`)
	if err != nil {
		return 0, fmt.Errorf("store: dọn phiên: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
