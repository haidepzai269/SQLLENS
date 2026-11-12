package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

func TestGenerateAndParseUserToken(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	future := time.Now().Add(30 * 24 * time.Hour)

	t.Run("user thường", func(t *testing.T) {
		u := store.User{
			ID:          "user-123",
			DisplayName: "Nguyễn Văn A",
			Email:       "a@example.com",
			Role:        "user",
		}
		tok, err := GenerateUserToken(u, secret, time.Hour)
		if err != nil {
			t.Fatalf("GenerateUserToken error: %v", err)
		}
		claims, err := ParseUserToken(tok, secret)
		if err != nil {
			t.Fatalf("ParseUserToken error: %v", err)
		}
		if claims.UserID != u.ID || claims.Role != "user" {
			t.Errorf("claims mismatch: got %+v, want uid=%s, role=user", claims, u.ID)
		}
		if claims.IsVIP() {
			t.Error("user thường không được là VIP")
		}
	})

	t.Run("vip còn hạn", func(t *testing.T) {
		u := store.User{
			ID:       "vip-456",
			Role:     "vip",
			VipUntil: &future,
		}
		tok, err := GenerateUserToken(u, secret, time.Hour)
		if err != nil {
			t.Fatalf("GenerateUserToken error: %v", err)
		}
		claims, err := ParseUserToken(tok, secret)
		if err != nil {
			t.Fatalf("ParseUserToken error: %v", err)
		}
		if claims.UserID != u.ID || claims.Role != "vip" {
			t.Errorf("claims mismatch: got %+v", claims)
		}
		if !claims.IsVIP() {
			t.Error("vip còn hạn phải là VIP")
		}
	})

	t.Run("vip vĩnh viễn (vip_until nil)", func(t *testing.T) {
		u := store.User{
			ID:       "vip-forever",
			Role:     "vip",
			VipUntil: nil,
		}
		tok, err := GenerateUserToken(u, secret, time.Hour)
		if err != nil {
			t.Fatalf("GenerateUserToken error: %v", err)
		}
		claims, err := ParseUserToken(tok, secret)
		if err != nil {
			t.Fatalf("ParseUserToken error: %v", err)
		}
		if !claims.IsVIP() {
			t.Error("vip vĩnh viễn phải là VIP")
		}
	})

	t.Run("role rỗng fallback thành user", func(t *testing.T) {
		u := store.User{
			ID:   "fallback-user",
			Role: "",
		}
		tok, err := GenerateUserToken(u, secret, time.Hour)
		if err != nil {
			t.Fatalf("GenerateUserToken error: %v", err)
		}
		claims, err := ParseUserToken(tok, secret)
		if err != nil {
			t.Fatalf("ParseUserToken error: %v", err)
		}
		if claims.Role != "user" {
			t.Errorf("role phải fallback về 'user', got %q", claims.Role)
		}
	})
}

func TestTokenExpired(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	u := store.User{
		ID:   "exp-user",
		Role: "user",
	}

	// Tạo token hết hạn thủ công bằng Claims với exp trong quá khứ
	header := jwtHeader{Alg: "HS256", Typ: "JWT"}
	headerBytes, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	past := time.Now().Add(-10 * time.Minute)
	claims := Claims{
		UserID:    u.ID,
		Role:      "user",
		IssuedAt:  past.Add(-time.Hour).Unix(),
		ExpiresAt: past.Unix(),
	}
	claimsBytes, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(claimsBytes)

	raw := headerB64 + "." + payloadB64
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(raw))
	sigB64 := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	expiredTok := raw + "." + sigB64

	_, err := ParseUserToken(expiredTok, secret)
	if !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("mong đợi ErrTokenExpired, got: %v", err)
	}
}

func TestInvalidSignature(t *testing.T) {
	secretA := []byte("this-is-a-very-secure-32-byte-secret-key-A!")
	secretB := []byte("this-is-a-very-secure-32-byte-secret-key-B!")
	u := store.User{ID: "tamper-user", Role: "user"}

	tok, err := GenerateUserToken(u, secretA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Parse bằng secret khác
	if _, err := ParseUserToken(tok, secretB); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("secret khác phải trả ErrInvalidToken, got: %v", err)
	}

	// 2. Thay đổi phần payload
	parts := []string{"", "", ""}
	copy(parts, []string{tok[0:10], tok[11:20], tok[21:]})
	tampered := tok + "corrupt"
	if _, err := ParseUserToken(tampered, secretA); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("token bị sửa đổi phải trả ErrInvalidToken, got: %v", err)
	}
}

func TestMalformedToken(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")

	badTokens := []string{
		"",
		"not-a-jwt",
		"only.two.parts.extra.parts",
		"badbase64!@#.badpayload.badsig",
		"eyJhbGciOiJOT05FIn0.eyJ1aWQiOiIxIn0.c2ln", // thuật toán không phải HS256
	}

	for _, bt := range badTokens {
		t.Run("token="+bt, func(t *testing.T) {
			if _, err := ParseUserToken(bt, secret); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("token dị tật phải trả ErrInvalidToken, got: %v", err)
			}
		})
	}
}

func TestSecretTooShort(t *testing.T) {
	shortSecret := []byte("too-short")
	u := store.User{ID: "test"}

	if _, err := GenerateUserToken(u, shortSecret, time.Hour); err == nil {
		t.Fatal("secret ngắn phải bị từ chối khi generate")
	}

	if _, err := ParseUserToken("a.b.c", shortSecret); err == nil {
		t.Fatal("secret ngắn phải bị từ chối khi parse")
	}
}

func TestLegacyTokenFallback(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")

	// Giả lập token được tạo từ hệ thống cũ không có trường role
	header := jwtHeader{Alg: "HS256", Typ: "JWT"}
	headerBytes, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	legacyPayload := map[string]any{
		"uid": "legacy-123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	payloadBytes, _ := json.Marshal(legacyPayload)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadBytes)

	raw := headerB64 + "." + payloadB64
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(raw))
	sigB64 := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	legacyTok := raw + "." + sigB64

	claims, err := ParseUserToken(legacyTok, secret)
	if err != nil {
		t.Fatalf("ParseUserToken lỗi: %v", err)
	}
	if claims.Role != "user" {
		t.Fatalf("token cũ không có role phải fallback về 'user', got %q", claims.Role)
	}
	if claims.IsVIP() {
		t.Fatal("token cũ fallback role 'user' không được là VIP")
	}
}
