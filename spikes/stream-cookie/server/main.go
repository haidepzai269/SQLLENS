// Spike Task014: kiểm cookie và stream khi đi qua rewrites của Next.js. Không dùng cho production.
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":18140"
	}
	// COOKIE_SECURE=1 khi chạy sau HTTPS (Vercel/Render). Trên http://localhost trình duyệt từ chối cookie Secure.
	secure := os.Getenv("COOKIE_SECURE") == "1"
	// STREAM_HEADERS=none để tắt header chống gom (AC3, kiểm từng header).
	hdrs := os.Getenv("STREAM_HEADERS")

	r := gin.New()
	r.GET("/login", func(c *gin.Context) {
		http.SetCookie(c.Writer, &http.Cookie{
			Name: "sid", Value: "spike-session", Path: "/", HttpOnly: true,
			Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: 3600,
		})
		c.JSON(200, gin.H{"ok": true})
	})
	r.GET("/me", func(c *gin.Context) {
		sid, err := c.Cookie("sid")
		c.Header("Cache-Control", "no-store")
		c.JSON(200, gin.H{"sid": sid, "has": err == nil, "host": c.Request.Host})
	})
	r.GET("/stream", func(c *gin.Context) {
		h := c.Writer.Header()
		set := func(k, v string) {
			if hdrs == "none" || hdrs == "no-"+k {
				return
			}
			h.Set(k, v)
		}
		if hdrs == "none" || hdrs == "no-ct" {
			h.Set("Content-Type", "text/plain; charset=utf-8")
		} else {
			h.Set("Content-Type", "text/event-stream")
		}
		set("Cache-Control", "no-cache")
		set("X-Accel-Buffering", "no")
		c.Writer.WriteHeader(200)
		c.Writer.Flush()
		for i := 1; i <= 10; i++ {
			select {
			case <-c.Request.Context().Done():
				return
			case <-time.After(300 * time.Millisecond):
			}
			fmt.Fprintf(c.Writer, "data: {\"n\":%d,\"sentAt\":%d}\n\n", i, time.Now().UnixMilli())
			c.Writer.Flush()
		}
	})
	if err := r.Run(addr); err != nil {
		panic(err)
	}
}
