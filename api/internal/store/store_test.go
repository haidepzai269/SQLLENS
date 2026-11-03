package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Cần Postgres: đặt T041_DATABASE_URL, ví dụ postgres://postgres:pw@localhost:54410/app
func newStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("T041_DATABASE_URL")
	if url == "" {
		t.Skip("bỏ qua: chưa đặt T041_DATABASE_URL (cần Postgres trong Docker)")
	}
	if !strings.Contains(url, "@localhost:") && !strings.Contains(url, "@127.0.0.1:") {
		t.Fatal("từ chối chạy: test xóa bảng, chỉ cho phép database ở localhost")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if _, err := s.pool.Exec(ctx, `DROP TABLE IF EXISTS sessions, identities, users, schema_migrations`); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestMigrateTwice(t *testing.T) { // AC1
	s := newStore(t)
	ctx := context.Background()
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("schema_migrations = %d, %v", n, err)
	}
}

func TestUpsertIdentity(t *testing.T) { // AC2 + ca biên tên
	s := newStore(t)
	ctx := context.Background()
	a, err := s.UpsertIdentity(ctx, "google", "123", Profile{DisplayName: "A", Email: "x@y.z"})
	if err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("😀", 1000)
	b, err := s.UpsertIdentity(ctx, "google", "123", Profile{DisplayName: long, AvatarURL: "http://a/b.png"})
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != b.ID || b.DisplayName != long || b.AvatarURL != "http://a/b.png" {
		t.Fatalf("không cập nhật đúng: %+v", b)
	}
	// nhà cung cấp không trả email lần sau: giữ email cũ
	if d, err := s.UpsertIdentity(ctx, "google", "123", Profile{DisplayName: "A"}); err != nil || d.Email != "x@y.z" || d.AvatarURL != "http://a/b.png" {
		t.Fatalf("mất email hoặc ảnh: %+v %v", d, err)
	}
	c, err := s.UpsertIdentity(ctx, "github", "123", Profile{DisplayName: "A", Email: "x@y.z"})
	if err != nil || c.ID == a.ID {
		t.Fatalf("github phải là user khác: %+v %v", c, err)
	}
	if _, err := s.UpsertIdentity(ctx, "facebook", "1", Profile{}); err == nil {
		t.Fatal("phải từ chối nhà cung cấp lạ")
	}
	if _, err := s.UpsertIdentity(ctx, "google", "9", Profile{DisplayName: "a\x00b\xff"}); err != nil {
		t.Fatalf("NUL và UTF-8 hỏng phải được làm sạch: %v", err)
	}
}

func TestUpsertConcurrent(t *testing.T) { // AC4
	s := newStore(t)
	ctx := context.Background()
	ids := make([]string, 12)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, err := s.UpsertIdentity(ctx, "github", "same", Profile{DisplayName: "N"})
			if err != nil {
				t.Error(err)
				return
			}
			ids[i] = u.ID
		}()
	}
	wg.Wait()
	var users int
	_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&users)
	if users != 1 {
		t.Fatalf("có %d user, mong đợi 1", users)
	}
	for _, id := range ids {
		if id != ids[0] {
			t.Fatal("id khác nhau")
		}
	}
}

func TestSessions(t *testing.T) { // AC3
	s := newStore(t)
	ctx := context.Background()
	u, _ := s.UpsertIdentity(ctx, "google", "1", Profile{DisplayName: "A"})
	tok, err := s.CreateSession(ctx, u.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < 43 { // 32 byte base64url
		t.Fatalf("token quá ngắn: %d", len(tok))
	}
	var stored []byte
	if err := s.pool.QueryRow(ctx, `SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(tok))
	if string(stored) != string(want[:]) {
		t.Fatal("database không chứa băm SHA-256 của token")
	}
	got, err := s.SessionUser(ctx, tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("SessionUser: %+v %v", got, err)
	}
	if _, err := s.SessionUser(ctx, tok+"x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("token sai: %v", err)
	}
	if _, err := s.SessionUser(ctx, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("token rỗng: %v", err)
	}
	if err := s.DeleteSession(ctx, tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionUser(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatalf("token đã xóa: %v", err)
	}
	if _, err := s.CreateSession(ctx, u.ID, 0); err == nil {
		t.Fatal("ttl 0 phải lỗi")
	}
}

func TestExpired(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u, _ := s.UpsertIdentity(ctx, "google", "1", Profile{DisplayName: "A"})
	tok, _ := s.CreateSession(ctx, u.ID, time.Hour)
	keep, _ := s.CreateSession(ctx, u.ID, time.Hour)
	if _, err := s.pool.Exec(ctx, `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, hashToken(tok)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionUser(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatalf("hết hạn: %v", err)
	}
	n, err := s.DeleteExpired(ctx)
	if err != nil || n != 1 {
		t.Fatalf("DeleteExpired = %d, %v", n, err)
	}
	if _, err := s.SessionUser(ctx, keep); err != nil {
		t.Fatal(err)
	}
}

// Không cần Docker: database không kết nối được phải trả lỗi rõ, không panic, không lộ mật khẩu.
func TestOpenErrors(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := Open(ctx, "postgres://u:secretpw@127.0.0.1:1/app")
	if err == nil || strings.Contains(err.Error(), "secretpw") {
		t.Fatalf("lỗi = %v", err)
	}
	if _, err := Open(ctx, "postgres://u:secretpw@[bad"); err == nil || strings.Contains(err.Error(), "secretpw") {
		t.Fatalf("lỗi = %v", err)
	}
}
