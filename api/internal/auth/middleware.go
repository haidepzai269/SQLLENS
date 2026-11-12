package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

const (
	claimsKey = "auth.claims"
)

// abortVipRequired trả về HTTP 403 Forbidden theo định dạng chuẩn hệ thống.
func abortVipRequired(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"error": gin.H{
			"code":       "vip_required",
			"messageKey": "error.vipRequired",
		},
		"message": "Tính năng yêu cầu tài khoản VIP",
	})
}

func requireVipInternal(secret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Kiểm tra User từ cookie session trong context
		if val, exists := c.Get(userKey); exists {
			if u, ok := val.(store.User); ok {
				if u.IsVIP() {
					c.Next()
					return
				}
				// Đã xác thực nhưng không phải VIP hoặc đã hết hạn
				abortVipRequired(c)
				return
			}
		}

		// 2. Kiểm tra Claims từ context
		if val, exists := c.Get(claimsKey); exists {
			if claims, ok := val.(*Claims); ok {
				if claims.IsVIP() {
					c.Next()
					return
				}
				abortVipRequired(c)
				return
			}
		}

		// 3. Kiểm tra Header Authorization: Bearer <token>
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			if tokenStr != "" && len(secret) >= 32 {
				claims, err := ParseUserToken(tokenStr, secret)
				if err == nil {
					c.Set(claimsKey, claims)
					if claims.IsVIP() {
						c.Next()
						return
					}
					// Token hợp lệ nhưng không phải VIP hoặc đã hết hạn
					abortVipRequired(c)
					return
				}
			}
		}

		// Chưa xác thực
		httpapi.Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
	}
}

func requireRoleInternal(secret []byte, roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[strings.ToLower(strings.TrimSpace(r))] = true
	}

	return func(c *gin.Context) {
		var role string
		var authenticated bool

		if val, exists := c.Get(userKey); exists {
			if u, ok := val.(store.User); ok {
				role = u.Role
				authenticated = true
			}
		}

		if !authenticated {
			if val, exists := c.Get(claimsKey); exists {
				if claims, ok := val.(*Claims); ok {
					role = claims.Role
					authenticated = true
				}
			}
		}

		if !authenticated {
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
				if tokenStr != "" && len(secret) >= 32 {
					if claims, err := ParseUserToken(tokenStr, secret); err == nil {
						role = claims.Role
						authenticated = true
						c.Set(claimsKey, claims)
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

		if !allowed[strings.ToLower(role)] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": gin.H{
					"code":       "forbidden",
					"messageKey": "error.forbidden",
				},
				"message": "Không có quyền truy cập",
			})
			return
		}

		c.Next()
	}
}

// RequireVip trên struct Auth sử dụng session secret của hệ thống để xác thực.
func (a *Auth) RequireVip() gin.HandlerFunc {
	return requireVipInternal(a.secret)
}

// RequireRole trên struct Auth kiểm tra quyền theo danh sách vai trò cho phép.
func (a *Auth) RequireRole(roles ...string) gin.HandlerFunc {
	return requireRoleInternal(a.secret, roles...)
}

// RequireVip là hàm tiện ích nhận optional secret hoặc dùng với context user hiện tại.
func RequireVip(optionalSecret ...[]byte) gin.HandlerFunc {
	var sec []byte
	if len(optionalSecret) > 0 {
		sec = optionalSecret[0]
	}
	return requireVipInternal(sec)
}

// RequireRole là hàm tiện ích kiểm tra role khi đã có user trong context.
func RequireRole(roles ...string) gin.HandlerFunc {
	return requireRoleInternal(nil, roles...)
}

// RequireRoleWithSecret kiểm tra role hỗ trợ cả giải mã Bearer JWT token.
func RequireRoleWithSecret(secret []byte, roles ...string) gin.HandlerFunc {
	return requireRoleInternal(secret, roles...)
}
