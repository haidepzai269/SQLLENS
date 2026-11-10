package auth

import (
	"sync"
	"testing"
	"time"
)

func TestLocalBanCache_Basic(t *testing.T) {
	c := NewLocalBanCache(100 * time.Millisecond)
	defer c.Close()

	ip := "192.0.2.1"

	// Chưa ban
	banned, ttl := c.IsBanned(ip)
	if banned || ttl != 0 {
		t.Fatalf("expected not banned, got banned=%v ttl=%d", banned, ttl)
	}

	// Set ban 500ms
	c.SetBanned(ip, 500*time.Millisecond)

	banned, ttl = c.IsBanned(ip)
	if !banned || ttl < 1 {
		t.Fatalf("expected banned=true with ttl >= 1, got banned=%v ttl=%d", banned, ttl)
	}

	// Đợi hết hạn
	time.Sleep(550 * time.Millisecond)
	banned, ttl = c.IsBanned(ip)
	if banned || ttl != 0 {
		t.Fatalf("expected expired ban, got banned=%v ttl=%d", banned, ttl)
	}

	// Đợi cleanup loop dọn dẹp
	time.Sleep(150 * time.Millisecond)
	if c.Len() != 0 {
		t.Fatalf("expected 0 items after purge, got %d", c.Len())
	}
}

func TestLocalBanCache_MaxTTLClamp(t *testing.T) {
	c := NewLocalBanCache(0) // dùng DefaultCleanupInterval
	defer c.Close()

	ip := "192.0.2.2"
	// Set ban 15 phút (900s), nhưng RAM cache phải clamp về tối đa 60s
	c.SetBanned(ip, 900*time.Second)

	banned, ttl := c.IsBanned(ip)
	if !banned {
		t.Fatalf("expected banned=true")
	}
	if ttl > 60 {
		t.Fatalf("expected ttl <= 60, got %d", ttl)
	}
}

func TestLocalBanCache_RemoveAndClear(t *testing.T) {
	c := NewLocalBanCache(time.Minute)
	defer c.Close()

	c.SetBanned("1.1.1.1", 10*time.Second)
	c.SetBanned("2.2.2.2", 10*time.Second)
	if c.Len() != 2 {
		t.Fatalf("expected len 2, got %d", c.Len())
	}

	c.Remove("1.1.1.1")
	banned, _ := c.IsBanned("1.1.1.1")
	if banned {
		t.Errorf("1.1.1.1 should have been removed")
	}
	if c.Len() != 1 {
		t.Errorf("expected len 1, got %d", c.Len())
	}

	c.Clear()
	if c.Len() != 0 {
		t.Errorf("expected len 0 after Clear, got %d", c.Len())
	}
}

func TestLocalBanCache_Concurrency(t *testing.T) {
	c := NewLocalBanCache(50 * time.Millisecond)
	defer c.Close()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			ip := "10.0.0.1"
			for j := 0; j < 100; j++ {
				c.SetBanned(ip, 100*time.Millisecond)
				c.IsBanned(ip)
				if j%10 == 0 {
					c.PurgeExpired()
				}
			}
		}(i)
	}
	wg.Wait()
}

func TestLocalBanCache_NilSafety(t *testing.T) {
	var c *LocalBanCache
	banned, ttl := c.IsBanned("1.1.1.1")
	if banned || ttl != 0 {
		t.Errorf("nil cache IsBanned returned banned=%v ttl=%d", banned, ttl)
	}
	c.SetBanned("1.1.1.1", time.Second)
	c.Remove("1.1.1.1")
	c.Clear()
	c.PurgeExpired()
	c.Close()
	if l := c.Len(); l != 0 {
		t.Errorf("nil cache Len returned %d", l)
	}
}
