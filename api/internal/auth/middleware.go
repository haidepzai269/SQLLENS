package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

const (
	claimsKey = "auth.claims"
)

// SessionFinder định nghĩa giao diện truy vấn tài khoản từ session token (thoả mãn bởi *store.Store).
type SessionFinder interface {
	SessionUser(ctx context.Context, token string) (store.User, error)
}

// VIPDemoter định nghĩa giao diện tự động hạ role VIP khi phát hiện hết hạn.
type VIPDemoter interface {
	DemoteExpiredVIP(ctx context.Context, userID string) error
}

// abortVipRequired trả về HTTP 403 Forbidden theo định dạng chuẩn hệ thống khi yêu cầu VIP.
func abortVipRequired(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"error": gin.H{
			"code":       "vip_required",
			"messageKey": "error.vipRequired",
		},
		"message": "Tính năng yêu cầu tài khoản VIP",
	})
}

// abortVipExpired trả về HTTP 403 Forbidden khi tài khoản VIP đã hết hạn.
func abortVipExpired(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"error": gin.H{
			"code":       "vip_expired",
			"messageKey": "error.vipExpired",
		},
		"message": "Gói tài khoản VIP của bạn đã hết hạn",
	})
}

// extractSessionCookie tìm token phiên từ cookie sid hoặc sqllens_session.
func extractSessionCookie(c *gin.Context) string {
	if tok, err := c.Cookie(cookieName); err == nil && tok != "" {
		return tok
	}
	if tok, err := c.Cookie("sqllens_session"); err == nil && tok != "" {
		return tok
	}
	return ""
}

func requireVipInternal(secret []byte, finder SessionFinder) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Kiểm tra User từ context (được inject trước hoặc qua middleware khác)
		if val, exists := c.Get(userKey); exists {
			if u, ok := val.(store.User); ok {
				if strings.ToLower(u.Role) != "vip" {
					abortVipRequired(c)
					return
				}
				if u.IsVIP() {
					c.Next()
					return
				}
				// Role là vip nhưng IsVIP() false (vip_until đã hết hạn)
				if finder != nil {
					if demoter, ok := finder.(VIPDemoter); ok {
						_ = demoter.DemoteExpiredVIP(c.Request.Context(), u.ID)
					}
				}
				abortVipExpired(c)
				return
			}
		}

		// 2. Kiểm tra Claims từ context
		if val, exists := c.Get(claimsKey); exists {
			if claims, ok := val.(*Claims); ok {
				if strings.ToLower(claims.Role) != "vip" {
					abortVipRequired(c)
					return
				}
				if claims.IsVIP() {
					c.Next()
					return
				}
				abortVipExpired(c)
				return
			}
		}

		// 3. Tự động đọc và kiểm tra Session Cookie nếu context chưa có user
		tok := extractSessionCookie(c)
		if tok != "" && len(secret) >= 32 && finder != nil {
			if rawTok, ok := verifyToken(tok, secret); ok {
				u, err := finder.SessionUser(c.Request.Context(), rawTok)
				switch {
				case err == nil:
					c.Set(userKey, u)
					if strings.ToLower(u.Role) != "vip" {
						abortVipRequired(c)
						return
					}
					if u.IsVIP() {
						c.Next()
						return
					}
					if demoter, ok := finder.(VIPDemoter); ok {
						_ = demoter.DemoteExpiredVIP(c.Request.Context(), u.ID)
					}
					abortVipExpired(c)
					return
				case errors.Is(err, store.ErrNotFound):
					// Session không tồn tại hoặc đã hết hạn trong DB, tiếp tục rơi xuống kiểm tra bearer hoặc 401
				default:
					httpapi.Abort(c, http.StatusServiceUnavailable, "auth_unavailable", "error.authUnavailable")
					return
				}
			}
		}

		// 4. Kiểm tra Header Authorization: Bearer <token> (hỗ trợ JWT)
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			if tokenStr != "" && len(secret) >= 32 {
				claims, err := ParseUserToken(tokenStr, secret)
				if err == nil {
					c.Set(claimsKey, claims)
					if strings.ToLower(claims.Role) != "vip" {
						abortVipRequired(c)
						return
					}
					if claims.IsVIP() {
						c.Next()
						return
					}
					abortVipExpired(c)
					return
				}
			}
		}

		// Chưa xác thực
		httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
	}
}

func requireRoleInternal(secret []byte, finder SessionFinder, roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[strings.ToLower(strings.TrimSpace(r))] = true
	}

	return func(c *gin.Context) {
		var role string
		var authenticated bool
		var user *store.User
		var claims *Claims

		// 1. Context user
		if val, exists := c.Get(userKey); exists {
			if u, ok := val.(store.User); ok {
				role = u.Role
				user = &u
				authenticated = true
			}
		}

		// 2. Context claims
		if !authenticated {
			if val, exists := c.Get(claimsKey); exists {
				if cl, ok := val.(*Claims); ok {
					role = cl.Role
					claims = cl
					authenticated = true
				}
			}
		}

		// 3. Session cookie
		if !authenticated {
			tok := extractSessionCookie(c)
			if tok != "" && len(secret) >= 32 && finder != nil {
				if rawTok, ok := verifyToken(tok, secret); ok {
					u, err := finder.SessionUser(c.Request.Context(), rawTok)
					if err == nil {
						role = u.Role
						user = &u
						authenticated = true
						c.Set(userKey, u)
					}
				}
			}
		}

		// 4. Header Bearer
		if !authenticated {
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
				if tokenStr != "" && len(secret) >= 32 {
					if cl, err := ParseUserToken(tokenStr, secret); err == nil {
						role = cl.Role
						claims = cl
						authenticated = true
						c.Set(claimsKey, cl)
					}
				}
			}
		}

		if !authenticated {
			httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
			return
		}

		if role == "" {
			role = "user"
		}

		roleLower := strings.ToLower(role)

		if !allowed[roleLower] {
			if allowed["vip"] && len(allowed) == 1 {
				abortVipRequired(c)
				return
			}
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": gin.H{
					"code":       "forbidden",
					"messageKey": "error.forbidden",
				},
				"message": "Không có quyền truy cập",
			})
			return
		}

		// Nếu role được yêu cầu chấp nhận VIP và user hiện tại có role "vip":
		// Bắt buộc kiểm tra hạn u.IsVIP() / claims.IsVIP()
		if roleLower == "vip" {
			if user != nil && !user.IsVIP() {
				if finder != nil {
					if demoter, ok := finder.(VIPDemoter); ok {
						_ = demoter.DemoteExpiredVIP(c.Request.Context(), user.ID)
					}
				}
				abortVipExpired(c)
				return
			}
			if claims != nil && !claims.IsVIP() {
				abortVipExpired(c)
				return
			}
		}

		c.Next()
	}
}

// RequireVip trên struct Auth sử dụng session secret và store của hệ thống để xác thực.
func (a *Auth) RequireVip() gin.HandlerFunc {
	return requireVipInternal(a.secret, a.store)
}

// RequireRole trên struct Auth kiểm tra quyền theo danh sách vai trò cho phép.
func (a *Auth) RequireRole(roles ...string) gin.HandlerFunc {
	return requireRoleInternal(a.secret, a.store, roles...)
}

// RequireVip là hàm tiện ích nhận optional secret hoặc dùng với context user hiện tại.
func RequireVip(optionalSecret ...[]byte) gin.HandlerFunc {
	var sec []byte
	if len(optionalSecret) > 0 {
		sec = optionalSecret[0]
	}
	return requireVipInternal(sec, nil)
}

// RequireVipWithStore tiện ích tạo middleware RequireVip kèm session finder.
func RequireVipWithStore(secret []byte, finder SessionFinder) gin.HandlerFunc {
	return requireVipInternal(secret, finder)
}

// RequireRole là hàm tiện ích kiểm tra role khi đã có user trong context.
func RequireRole(roles ...string) gin.HandlerFunc {
	return requireRoleInternal(nil, nil, roles...)
}

// RequireRoleWithSecret kiểm tra role hỗ trợ cả giải mã Bearer JWT token.
func RequireRoleWithSecret(secret []byte, roles ...string) gin.HandlerFunc {
	return requireRoleInternal(secret, nil, roles...)
}

// RequireRoleWithStore kiểm tra role hỗ trợ cả giải mã session cookie qua finder.
func RequireRoleWithStore(secret []byte, finder SessionFinder, roles ...string) gin.HandlerFunc {
	return requireRoleInternal(secret, finder, roles...)
}

// SignSessionToken là hàm hỗ trợ ký token phiên bằng HMAC-SHA256 theo chuẩn hệ thống.
func SignSessionToken(token string, secret []byte) string {
	return signToken(token, secret)
}
