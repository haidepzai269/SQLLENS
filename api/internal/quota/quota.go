// Package quota limits per-user use of costly features (MySQL, AI) with Upstash Redis over REST.
package quota

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Rule is one counter. Counters of different Rules never share keys.
type Rule struct {
	Name   string
	Limit  int
	Window time.Duration
}

// Defaults: a MySQL session costs real CPU/RAM on a 1 GB VM and AI calls cost provider quota.
// 20 sandbox sessions/day and 30 AI messages/day fit a learning session; change the numbers here.
var (
	MySQLSession = Rule{Name: "mysql_session", Limit: 20, Window: 24 * time.Hour}
	AIMessage    = Rule{Name: "ai_message", Limit: 30, Window: 24 * time.Hour}
)

const callTimeout = 2 * time.Second

// One atomic command per request: count, set TTL on first hit (or if a key somehow lost its TTL),
// return {count, ttl_ms}. Server-side TTL means local clock skew cannot change the window.
const script = `local c=redis.call('INCR',KEYS[1])
local t=redis.call('PTTL',KEYS[1])
if c==1 or t<0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) t=tonumber(ARGV[1]) end
return {c,t}`

type Limiter struct {
	url, token string
	hc         *http.Client
}

func New(restURL, restToken string, httpClient *http.Client) *Limiter {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: callTimeout}
	}
	return &Limiter{url: strings.TrimRight(restURL, "/"), token: restToken, hc: httpClient}
}

// key hashes rule+user so odd or huge user ids cannot inject or collide Redis keys.
func key(rule Rule, uid string) string {
	h := sha256.Sum256([]byte(rule.Name + "\x00" + uid))
	return "quota:" + hex.EncodeToString(h[:])
}

// hit returns the new count and the remaining window in ms. Any anomaly is an error.
func (l *Limiter) hit(ctx context.Context, rule Rule, uid string) (count, ttlMs int64, err error) {
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	body, _ := json.Marshal([]any{"EVAL", script, "1", key(rule, uid), strconv.FormatInt(rule.Window.Milliseconds(), 10)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.url, bytes.NewReader(body))
	if err != nil {
		return 0, 0, errors.New("bad request")
	}
	req.Header.Set("Authorization", "Bearer "+l.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := l.hc.Do(req)
	if err != nil {
		return 0, 0, errors.New("upstash unreachable")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil || resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("upstash status %d", resp.StatusCode)
	}
	var out struct {
		Result []int64 `json:"result"`
		Error  string  `json:"error"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Error != "" || len(out.Result) != 2 || out.Result[0] < 1 || out.Result[1] < 0 {
		return 0, 0, errors.New("upstash bad reply")
	}
	return out.Result[0], out.Result[1], nil
}

func abort(c *gin.Context, status int, code, messageKey string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "messageKey": messageKey}})
}

// Middleware counts one use per request. userID returns the user id; ok=false means not signed in.
func (l *Limiter) Middleware(rule Rule, userID func(*gin.Context) (string, bool)) gin.HandlerFunc {
	if rule.Name == "" || rule.Limit <= 0 || rule.Window < time.Millisecond {
		panic("quota: invalid rule")
	}
	return func(c *gin.Context) {
		uid, ok := userID(c)
		if !ok || uid == "" {
			abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
			return
		}
		count, ttl, err := l.hit(c.Request.Context(), rule, uid)
		if err != nil {
			// Fail closed: MySQL and AI cost real resources. Log rule and cause only, never user id or token.
			log.Printf("quota: rule=%s unavailable: %v", rule.Name, err)
			abort(c, http.StatusServiceUnavailable, "quota_unavailable", "error.quotaUnavailable")
			return
		}
		if count > int64(rule.Limit) {
			secs := (ttl + 999) / 1000
			if secs < 1 {
				secs = 1
			}
			c.Header("Retry-After", strconv.FormatInt(secs, 10))
			c.Header("X-Quota-Reset", time.Now().Add(time.Duration(ttl)*time.Millisecond).UTC().Format(time.RFC3339))
			abort(c, http.StatusTooManyRequests, "quota_exceeded", "error.quotaExceeded")
			return
		}
		c.Next()
	}
}
