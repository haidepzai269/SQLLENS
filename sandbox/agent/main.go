// Sandbox agent: tạo, chạy SQL, hủy phiên MySQL qua HTTP. Chỉ nghe loopback, cần token Bearer.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"crypto/sha256"

	"github.com/go-sql-driver/mysql"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			log.Fatalf("%s phải là số nguyên dương", k)
		}
		return n
	}
	return d
}

func readToken(path string) ([32]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return [32]byte{}, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return [32]byte{}, fmt.Errorf("file token phải quyền 600")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return [32]byte{}, err
	}
	tok := strings.TrimSpace(string(b))
	if len(tok) < 32 {
		return [32]byte{}, errors.New("token phải dài ít nhất 32 ký tự")
	}
	return sha256.Sum256([]byte(tok)), nil
}

var nameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,30}$`)

func realBackend(script, root string) backend {
	run := func(ctx context.Context, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, "bash", append([]string{script}, args...)...)
		cmd.Env = append(os.Environ(), "SESS_ROOT="+root)
		var out bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &out
		err := cmd.Run()
		return out.Bytes(), err
	}
	return backend{
		create: func(ctx context.Context, id string) error {
			_, err := run(ctx, "create", id)
			var ee *exec.ExitError
			if errors.As(err, &ee) && ee.ExitCode() == 3 {
				return errDiskLow
			}
			return err
		},
		destroy: func(id string) {
			if !nameRe.MatchString(id) {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			run(ctx, "destroy", id)
		},
		dirSize: func(id string) int64 { return dirBytes(filepath.Join(root, id)) },
		open: func(id, who string) (*sql.DB, error) {
			dir := filepath.Join(root, id)
			pw, err := os.ReadFile(filepath.Join(dir, who+".pw"))
			if err != nil {
				return nil, err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			pid, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Pid}}", "sqllens-mysql-"+id).Output()
			if err != nil {
				return nil, err
			}
			p := strings.TrimSpace(string(pid))
			if p == "" || p == "0" {
				return nil, errors.New("container không chạy")
			}
			cfg := mysql.NewConfig()
			cfg.User, cfg.Passwd, cfg.DBName = "sqllens_user", string(pw), "app"
			if who == "root" {
				cfg.User, cfg.DBName = "root", ""
			}
			// Container chạy --network none: socket nằm trong tmpfs của container, root ở máy chủ vào được qua /proc/PID/root.
			cfg.Net, cfg.Addr = "unix", "/proc/"+p+"/root/run/mysqld/mysqld.sock"
			cfg.MultiStatements, cfg.Timeout = true, 5*time.Second
			c, err := mysql.NewConnector(cfg)
			if err != nil {
				return nil, err
			}
			return sql.OpenDB(c), nil
		},
		list: func() []string {
			seen := map[string]bool{}
			if ents, err := os.ReadDir(root); err == nil {
				for _, e := range ents {
					seen[e.Name()] = true
				}
			}
			out, _ := exec.Command("docker", "ps", "-a", "--filter", "label=sqllens.session", "--format", `{{.Label "sqllens.session"}}`).Output()
			for _, n := range strings.Fields(string(out)) {
				seen[n] = true
			}
			var ids []string
			for n := range seen {
				if nameRe.MatchString(n) {
					ids = append(ids, n)
				}
			}
			return ids
		},
	}
}

func main() {
	addr := env("AGENT_ADDR", "127.0.0.1:8081")
	host, _, err := net.SplitHostPort(addr)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("AGENT_ADDR phải là địa chỉ loopback (127.0.0.1)")
	}
	tok, err := readToken(env("TOKEN_FILE", "/etc/sqllens-agent/token"))
	if err != nil {
		log.Fatalf("token: %v", err)
	}
	root := env("SESS_ROOT", "/var/lib/sqllens/sessions")
	cfg := config{
		MaxSessions:  envInt("MAX_SESSIONS", 2),
		IdleTTL:      time.Duration(envInt("IDLE_TTL_SEC", 900)) * time.Second,
		Tick:         time.Second,
		QueryTimeout: time.Duration(envInt("QUERY_TIMEOUT_SEC", 15)) * time.Second,
		DiskLimit:    int64(envInt("DISK_LIMIT_MB", 512)) << 20,
		MaxRows:      10000,
		MaxCellBytes: 8 << 20,
		SessRoot:     root,
	}
	m := newManager(cfg, realBackend(env("SESSION_SH", "/opt/sqllens/mysql-seed/session.sh"), root))
	m.cleanupStale()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go m.janitor(ctx)

	srv := &http.Server{
		Addr: addr, Handler: (&server{m: m, token: tok}).handler(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 240 * time.Second, IdleTimeout: 60 * time.Second,
	}
	go func() { <-ctx.Done(); srv.Shutdown(context.Background()) }()
	log.Printf("event=start addr=%s max=%d", addr, cfg.MaxSessions)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
