package auth

import (
	"sync"
	"time"
)

// rateLimiter: cửa sổ cố định theo khóa, trong bộ nhớ một instance. Chỉ để chặn bấm dồn trước khi tốn lệnh Upstash.
// shortcut: không chia sẻ giữa các instance, nâng lên Redis nếu chạy nhiều instance Gin.
type rateLimiter struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	m      map[string]*bucket
}

type bucket struct {
	n     int
	reset time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, m: map[string]*bucket{}}
}

func (r *rateLimiter) allow(key string) (wait time.Duration, ok bool) {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.m) > 10000 { // dọn khi phình to, tránh rò bộ nhớ
		for k, b := range r.m {
			if now.After(b.reset) {
				delete(r.m, k)
			}
		}
	}
	b := r.m[key]
	if b == nil || now.After(b.reset) {
		b = &bucket{reset: now.Add(r.window)}
		r.m[key] = b
	}
	b.n++
	if b.n > r.limit {
		return b.reset.Sub(now), false
	}
	return 0, true
}
