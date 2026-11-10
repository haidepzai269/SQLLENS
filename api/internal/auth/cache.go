package auth

import (
	"sync"
	"time"
)

const (
	// MaxLocalBanDuration: thời hạn tối đa lưu trong RAM Gin để định kỳ đồng bộ lại trạng thái từ Upstash.
	MaxLocalBanDuration = 60 * time.Second
	// DefaultCleanupInterval: chu kỳ quét dọn các IP hết hạn trong RAM để tránh rò rỉ bộ nhớ.
	DefaultCleanupInterval = 30 * time.Second
)

// LocalBanCache là bộ nhớ đệm cục bộ trong RAM của Gin để chặn nhanh tại Tầng 0 (0ms)
// các IP đang chịu án phạt Ban mà không cần gọi sang Upstash REST API.
type LocalBanCache struct {
	mu        sync.RWMutex
	items     map[string]time.Time
	stopCh    chan struct{}
	closeOnce sync.Once
}

// NewLocalBanCache khởi tạo LocalBanCache với goroutine dọn dẹp định kỳ để tránh rò rỉ RAM.
func NewLocalBanCache(cleanupInterval time.Duration) *LocalBanCache {
	if cleanupInterval <= 0 {
		cleanupInterval = DefaultCleanupInterval
	}
	c := &LocalBanCache{
		items:  make(map[string]time.Time),
		stopCh: make(chan struct{}),
	}
	go c.cleanupLoop(cleanupInterval)
	return c
}

// cleanupLoop quét dọn định kỳ các IP đã hết hạn khỏi bộ nhớ.
func (c *LocalBanCache) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.PurgeExpired()
		}
	}
}

// IsBanned kiểm tra Client IP có đang bị ban trong bộ nhớ đệm hay không (Tầng 0 Fast-Path).
// Trả về banned=true cùng thời gian còn lại (giây) trong 0ms.
func (c *LocalBanCache) IsBanned(ip string) (bool, int64) {
	if c == nil || ip == "" {
		return false, 0
	}
	c.mu.RLock()
	exp, exists := c.items[ip]
	c.mu.RUnlock()

	if !exists {
		return false, 0
	}

	now := time.Now()
	if now.Before(exp) {
		ttl := int64(exp.Sub(now).Seconds())
		if ttl < 1 {
			ttl = 1
		}
		return true, ttl
	}

	return false, 0
}

// SetBanned đưa Client IP vào danh sách Ban trong RAM với thời hạn tối đa 60 giây.
func (c *LocalBanCache) SetBanned(ip string, duration time.Duration) {
	if c == nil || ip == "" || duration <= 0 {
		return
	}
	if duration > MaxLocalBanDuration {
		duration = MaxLocalBanDuration
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[ip] = time.Now().Add(duration)
}

// Remove xóa Client IP khỏi bộ nhớ đệm (dùng khi ban kết thúc hoặc gỡ phạt).
func (c *LocalBanCache) Remove(ip string) {
	if c == nil || ip == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, ip)
}

// Clear xóa toàn bộ cache (dùng cho test hoặc reset).
func (c *LocalBanCache) Clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]time.Time)
}

// PurgeExpired dọn dẹp các IP đã hết hạn khỏi RAM để giải phóng bộ nhớ.
func (c *LocalBanCache) PurgeExpired() {
	if c == nil {
		return
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()

	for ip, exp := range c.items {
		if !now.Before(exp) {
			delete(c.items, ip)
		}
	}
}

// Len trả về số lượng IP đang được lưu trong cache.
func (c *LocalBanCache) Len() int {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
}

// Close dừng goroutine dọn dẹp định kỳ để tránh rò rỉ goroutine.
func (c *LocalBanCache) Close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() {
		close(c.stopCh)
	})
}
