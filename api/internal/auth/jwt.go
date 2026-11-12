package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

var (
	ErrInvalidToken = errors.New("auth: token không hợp lệ")
	ErrTokenExpired = errors.New("auth: token đã hết hạn")
)

// Claims chứa thông tin danh tính và quyền hạn người dùng trong JWT token.
type Claims struct {
	UserID    string     `json:"uid"`
	Role      string     `json:"role"`
	VipUntil  *time.Time `json:"vip_until,omitempty"`
	IssuedAt  int64      `json:"iat"`
	ExpiresAt int64      `json:"exp"`
}

// IsVIP kiểm tra xem Claims có quyền VIP còn hạn hay không.
func (c *Claims) IsVIP() bool {
	if c.Role != "vip" {
		return false
	}
	if c.VipUntil == nil {
		return true // VIP vĩnh viễn
	}
	return time.Now().Before(*c.VipUntil)
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

// GenerateUserToken sinh JWT token định dạng header.payload.signature dùng HMAC-SHA256 (Base64RawURLEncoding).
func GenerateUserToken(u store.User, secret []byte, ttl time.Duration) (string, error) {
	if len(secret) < 32 {
		return "", errors.New("auth: khóa ký JWT phải có tối thiểu 32 bytes")
	}
	if ttl <= 0 {
		return "", errors.New("auth: ttl phải dương")
	}

	header := jwtHeader{
		Alg: "HS256",
		Typ: "JWT",
	}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	role := strings.TrimSpace(u.Role)
	if role == "" {
		role = "user"
	}

	now := time.Now()
	claims := Claims{
		UserID:    u.ID,
		Role:      role,
		VipUntil:  u.VipUntil,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(ttl).Unix(),
	}

	claimsBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(claimsBytes)

	unsignedToken := headerB64 + "." + payloadB64

	h := hmac.New(sha256.New, secret)
	h.Write([]byte(unsignedToken))
	sigB64 := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	return unsignedToken + "." + sigB64, nil
}

// ParseUserToken kiểm tra chữ ký HMAC, giải mã payload và kiểm tra thời hạn token.
// Hỗ trợ fallback an toàn nếu token cũ không có trường role (gán mặc định "user").
func ParseUserToken(tokenStr string, secret []byte) (*Claims, error) {
	if len(secret) < 32 {
		return nil, errors.New("auth: khóa ký JWT phải có tối thiểu 32 bytes")
	}

	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrInvalidToken
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Alg != "HS256" {
		return nil, ErrInvalidToken
	}

	// Xác thực chữ ký bằng ConstantTimeCompare
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(parts[0] + "." + parts[1]))
	expectedSig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(parts[2]), []byte(expectedSig)) != 1 {
		return nil, ErrInvalidToken
	}

	// Giải mã Claims
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}

	var claims Claims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, ErrInvalidToken
	}

	// Fallback nếu token chưa có role (người dùng từ phiên bản cũ)
	if claims.Role == "" {
		claims.Role = "user"
	}

	// Kiểm tra hạn sử dụng
	if claims.ExpiresAt > 0 && time.Now().Unix() > claims.ExpiresAt {
		return nil, ErrTokenExpired
	}

	return &claims, nil
}
