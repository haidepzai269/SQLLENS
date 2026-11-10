// Package auth: đăng nhập OAuth (Google, GitHub), phiên cookie `sid`, chặn CSRF, và cổng đăng nhập cộng quota.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

const (
	cookieName = "sid"
	bindCookie = "oauth_bind"
	sessionTTL = 30 * 24 * time.Hour
	stateTTL   = 10 * time.Minute
	maxStates  = 10000
)

// Endpoints của một nhà cung cấp. Test đổi sang httptest.
type Endpoints struct{ Auth, Token, UserInfo string }

type Provider struct {
	ClientID, ClientSecret string
	Endpoints
}

// Config: trường rỗng nghĩa là chưa cấu hình, route liên quan trả 503.
type Config struct {
	PublicOrigin  string // https://host hoặc http://localhost:3000, không có path
	SessionSecret string // Tối thiểu 32 ký tự dùng ký HMAC-SHA256 cho session cookie sid
	Google, GitHub Provider
	HTTPClient    *http.Client // nil: client timeout 10 giây
}

type Deps struct {
	Config  Config
	Store   *store.Store   // nil: chưa có DATABASE_URL
	Limiter *quota.Limiter // nil: chưa có Upstash
}

type pending struct {
	provider, verifier, next string
	bind                     [32]byte
	exp                      time.Time
}

type Auth struct {
	cfg     Config
	origin  string // PublicOrigin đã chuẩn hóa, rỗng nếu không hợp lệ
	secret  []byte // Khóa bí mật ký cookie sid (tối thiểu 32 bytes)
	secure  bool
	store   *store.Store
	limiter *quota.Limiter
	hc      *http.Client
	rate    *rateLimiter

	mu     sync.Mutex
	states map[string]pending
}

// normalizeOrigin chỉ nhận scheme://host[:port], không path, query, userinfo.
func normalizeOrigin(s string) string {
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// Mount gắn /auth/*, /me, kiểm Origin cho mọi route đăng ký sau đó, và nhóm /mysql đã có cổng.
// Dùng Auth trả về để gắn cổng cho /ai ở SP012: a.Gate(quota.AIMessage).
func Mount(r *gin.Engine, d Deps) *Auth {
	sec := []byte(d.Config.SessionSecret)
	if len(sec) < 32 {
		log.Print("auth: SESSION_SECRET is missing or shorter than 32 bytes; generating ephemeral random secret for development")
		sec = make([]byte, 32)
		if _, err := rand.Read(sec); err != nil {
			panic("auth: crypto/rand failed to generate session secret: " + err.Error())
		}
	}
	a := &Auth{
		cfg:     d.Config,
		origin:  normalizeOrigin(d.Config.PublicOrigin),
		secret:  sec,
		store:   d.Store,
		limiter: d.Limiter,
		hc:      d.Config.HTTPClient,
		rate:    newRateLimiter(30, time.Minute),
		states:  map[string]pending{},
	}
	if a.hc == nil {
		a.hc = &http.Client{Timeout: 10 * time.Second}
	}
	if u, err := url.Parse(a.origin); err == nil {
		a.secure = !(u.Scheme == "http" && u.Hostname() == "localhost")
	}
	r.Use(a.originCheck)
	r.GET("/auth/:provider/start", a.start)
	r.GET("/auth/:provider/callback", a.callback)
	r.POST("/auth/logout", a.logout)
	r.GET("/me", a.requireUser, a.me)
	return a
}

func notConfigured(c *gin.Context) {
	httpapi.Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
}

// originCheck: mọi yêu cầu đổi trạng thái phải mang Origin đúng PUBLIC_ORIGIN.
func (a *Auth) originCheck(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if a.origin == "" {
			notConfigured(c)
			return
		}
		if c.GetHeader("Origin") != a.origin {
			httpapi.Abort(c, http.StatusForbidden, "origin_mismatch", "error.originMismatch")
			return
		}
	}
	c.Next()
}

// signToken ký token bằng HMAC-SHA256, trả về sid = <raw_token>.<signature_base64url> (87 ký tự).
func signToken(token string, secret []byte) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(token))
	sig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	return token + "." + sig
}

// verifyToken xác thực chữ ký HMAC-SHA256 bằng subtle.ConstantTimeCompare trong RAM Gin.
// Bắt buộc chuỗi có đúng 2 phần, mỗi phần 43 ký tự (độ dài tổng đúng 87 ký tự).
func verifyToken(signedTok string, secret []byte) (string, bool) {
	if len(signedTok) != 87 {
		return "", false
	}
	parts := strings.Split(signedTok, ".")
	if len(parts) != 2 || len(parts[0]) != 43 || len(parts[1]) != 43 {
		return "", false
	}
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(parts[0]))
	expectedSig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(parts[1]), []byte(expectedSig)) != 1 {
		return "", false
	}
	return parts[0], true
}

func (a *Auth) sessionCookie(token string, maxAge int) *http.Cookie {
	val := token
	if val != "" {
		val = signToken(token, a.secret)
	}
	return &http.Cookie{Name: cookieName, Value: val, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode}
}

const userKey = "auth.user"

// requireUser chỉ đọc cookie sid. Không có cookie hoặc chữ ký HMAC sai/rác
// thì từ chối 401 ngay tại RAM mà không chạm database.
func (a *Auth) requireUser(c *gin.Context) {
	tok, err := c.Cookie(cookieName)
	if err != nil || tok == "" {
		httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
		return
	}
	rawTok, ok := verifyToken(tok, a.secret)
	if !ok {
		httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
		return
	}
	if a.store == nil {
		notConfigured(c)
		return
	}
	u, err := a.store.SessionUser(c.Request.Context(), rawTok)
	switch {
	case errors.Is(err, store.ErrNotFound):
		httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
	case err != nil:
		log.Print("auth: session lookup failed")
		httpapi.Abort(c, http.StatusServiceUnavailable, "auth_unavailable", "error.authUnavailable")
	default:
		c.Set(userKey, u)
		c.Next()
	}
}

// Gate = đăng nhập, rồi giới hạn tần suất thô theo user (bảo vệ Upstash và Neon), rồi quota.
// Giới hạn thô theo user thay vì theo IP: sau Vercel rewrite và proxy của Render, IP kết nối là IP proxy chung.
func (a *Auth) Gate(rule quota.Rule) []gin.HandlerFunc {
	uid := func(c *gin.Context) (string, bool) {
		u, ok := c.Get(userKey)
		if !ok {
			return "", false
		}
		return u.(store.User).ID, true
	}
	q := gin.HandlerFunc(notConfigured)
	if a.limiter != nil {
		q = a.limiter.Middleware(rule, uid)
	}
	return []gin.HandlerFunc{a.requireUser, func(c *gin.Context) {
		id, _ := uid(c)
		if wait, ok := a.rate.allow(id); !ok {
			c.Header("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			httpapi.Abort(c, http.StatusTooManyRequests, "rate_limited", "error.rateLimited")
			return
		}
		c.Next()
	}, q}
}

func (a *Auth) me(c *gin.Context) {
	u := c.MustGet(userKey).(store.User)
	var avatar *string
	if u.AvatarURL != "" {
		avatar = &u.AvatarURL
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"id": u.ID, "name": u.DisplayName, "avatarUrl": avatar, "provider": u.Provider})
}

func (a *Auth) logout(c *gin.Context) {
	tok, _ := c.Cookie(cookieName)
	http.SetCookie(c.Writer, a.sessionCookie("", -1))
	c.Header("Cache-Control", "no-store")
	if tok != "" {
		if rawTok, ok := verifyToken(tok, a.secret); ok {
			if a.store == nil {
				notConfigured(c)
				return
			}
			if err := a.store.DeleteSession(c.Request.Context(), rawTok); err != nil {
				log.Print("auth: delete session failed")
				httpapi.Abort(c, http.StatusServiceUnavailable, "auth_unavailable", "error.authUnavailable")
				return
			}
		}
	}
	c.Status(http.StatusNoContent)
}

// CleanupExpired xóa phiên hết hạn ngay lúc gọi rồi mỗi interval (nên >= vài giờ để Neon còn tự tắt).
func CleanupExpired(ctx context.Context, s *store.Store, interval time.Duration) {
	run := func() {
		if _, err := s.DeleteExpired(ctx); err != nil && ctx.Err() == nil {
			log.Print("auth: cleanup expired sessions failed")
		}
	}
	run()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("auth: crypto/rand failed") // không có entropy thì không được cấp state
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func sum(s string) [32]byte { return sha256.Sum256([]byte(s)) }

func (a *Auth) putState(state string, p pending) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.states) >= maxStates {
		now := time.Now()
		for k, v := range a.states {
			if now.After(v.exp) {
				delete(a.states, k)
			}
		}
		if len(a.states) >= maxStates {
			return false
		}
	}
	a.states[state] = p
	return true
}

// takeState dùng được đúng một lần: lấy ra là xóa.
func (a *Auth) takeState(state string) (pending, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.states[state]
	delete(a.states, state)
	return p, ok && time.Now().Before(p.exp)
}

func eq(a, b [32]byte) bool { return subtle.ConstantTimeCompare(a[:], b[:]) == 1 }

// UserID returns the signed-in user's id. Empty when called outside a Gate/requireUser route.
func UserID(c *gin.Context) string {
	u, _ := c.Get(userKey)
	if v, ok := u.(store.User); ok {
		return v.ID
	}
	return ""
}
