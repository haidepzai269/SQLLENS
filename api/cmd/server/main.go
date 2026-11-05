package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/haidepzai269/SQLLENS/api/internal/ai"
	"github.com/haidepzai269/SQLLENS/api/internal/auth"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/mysql"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

// cleanupEvery thưa để Neon còn tự tắt giữa hai lần dọn.
const cleanupEvery = 6 * time.Hour

// build dựng router. Thiếu biến môi trường nào thì phần cần biến đó trả 503, server vẫn chạy và /healthz vẫn ổn.
func build(ctx context.Context) *gin.Engine {
	cfg := auth.Config{
		PublicOrigin: os.Getenv("PUBLIC_ORIGIN"),
		Google:       auth.Provider{ClientID: os.Getenv("GOOGLE_CLIENT_ID"), ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET")},
		GitHub:       auth.Provider{ClientID: os.Getenv("GITHUB_CLIENT_ID"), ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET")},
	}
	d := auth.Deps{Config: cfg}
	if u := os.Getenv("DATABASE_URL"); u != "" {
		s, err := store.Open(ctx, u)
		if err == nil {
			err = s.Migrate(ctx)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "database:", err) // lỗi store không chứa mật khẩu
		} else {
			d.Store = s
			go auth.CleanupExpired(ctx, s, cleanupEvery)
		}
	}
	if u, t := os.Getenv("UPSTASH_REDIS_REST_URL"), os.Getenv("UPSTASH_REDIS_REST_TOKEN"); u != "" && t != "" {
		d.Limiter = quota.New(u, t, nil)
	}
	var budget mysql.Budget
	if u, t := os.Getenv("UPSTASH_REDIS_REST_URL"), os.Getenv("UPSTASH_REDIS_REST_TOKEN"); u != "" && t != "" {
		budget = mysql.NewUpstashBudget(u, t)
	}
	r := httpapi.NewRouter()
	a := auth.Mount(r, d)
	mysql.Mount(r, a, mysql.Config{URL: os.Getenv("SANDBOX_URL"), Token: os.Getenv("SANDBOX_TOKEN"), CertSHA256: os.Getenv("SANDBOX_CERT_SHA256")}, budget)
	ai.Mount(r, a.Gate(quota.AIMessage), ai.Config{GroqKey: os.Getenv("GROQ_API_KEY"), OpenRouterKey: os.Getenv("OPENROUTER_API_KEY")})
	return r
}

func port() (string, error) {
	p := os.Getenv("PORT")
	if p == "" {
		return "8080", nil
	}
	if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != p {
		return "", fmt.Errorf("invalid PORT %q: want an integer 1-65535", p)
	}
	return p, nil
}

func main() {
	p, err := port()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ln, err := net.Listen("tcp", ":"+p)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := httpapi.Serve(ctx, ln, build(ctx), httpapi.ShutdownTimeout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
