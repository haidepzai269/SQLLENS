// Sandbox agent: tạo, chạy SQL, hủy phiên MySQL qua HTTP. Cổng HTTP chỉ nghe loopback; cổng HTTPS (tùy chọn) cho Gin. Cần token Bearer.
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
		cmd.WaitDelay = 5 * time.Second // docker con giữ pipe thì Run vẫn trả về sau khi bash bị kill
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
		destroy: func(id string) error {
			if !nameRe.MatchString(id) {
				return nil
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			if _, err := run(ctx, "destroy", id); err != nil {
				return err
			}
			// kiểm lại thật: container không còn và thư mục đã mất
			if exec.CommandContext(ctx, "docker", "inspect", "sqllens-mysql-"+id).Run() == nil {
				return errors.New("container còn")
			}
			if _, err := os.Stat(filepath.Join(root, id)); err == nil {
				return errors.New("thư mục còn")
			}
			return nil
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

// quietLogger: thông báo của driver có thể trích câu lệnh, nên chỉ ghi loại sự kiện.
type quietLogger struct{}

func (quietLogger) Print(...any) { log.Print("event=driver_error") }

// tlsCmd: "sqllens-agent cert [-rotate]" tạo chứng chỉ rồi in vân tay; "fingerprint" chỉ in vân tay.
func tlsCmd(args []string) {
	dir := env("TLS_DIR", "/etc/sqllens-agent")
	if args[0] == "cert" {
		if err := genCert(dir, len(args) > 1 && args[1] == "-rotate"); err != nil {
			log.Fatalf("cert: %v", err)
		}
	}
	fp, err := fingerprint(dir)
	if err != nil {
		log.Fatalf("fingerprint: %v", err)
	}
	fmt.Println(fp)
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "cert" || os.Args[1] == "fingerprint") {
		tlsCmd(os.Args[1:])
		return
	}
	mysql.SetLogger(quietLogger{})
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
		MaxPerOwner:  envInt("MAX_PER_OWNER", 1), // máy chỉ chạy 2 phiên: một người không được giữ cả hai
		IdleTTL:      time.Duration(envInt("IDLE_TTL_SEC", 900)) * time.Second,
		Tick:         time.Second,
		QueryTimeout: time.Duration(envInt("QUERY_TIMEOUT_SEC", 15)) * time.Second,
		KillGrace:    5 * time.Second,
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

	h := (&server{m: m, token: tok}).handler()
	newSrv := func(a string) *http.Server {
		return &http.Server{
			Addr: a, Handler: h, MaxHeaderBytes: 16 << 10,
			ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 240 * time.Second, IdleTimeout: 60 * time.Second,
		}
	}
	srv := newSrv(addr)
	var tsrv *http.Server
	if ta := os.Getenv("AGENT_TLS_ADDR"); ta != "" {
		tc, err := loadTLS(env("TLS_DIR", "/etc/sqllens-agent"))
		if err != nil {
			log.Fatalf("tls: %v", err)
		}
		tsrv = newSrv(ta)
		tsrv.TLSConfig = tc
		go func() {
			if err := tsrv.ListenAndServeTLS("", ""); !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}()
		log.Printf("event=start_tls addr=%s", ta)
	}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
		if tsrv != nil {
			tsrv.Shutdown(context.Background())
		}
	}()
	log.Printf("event=start addr=%s max=%d per_owner=%d", addr, cfg.MaxSessions, cfg.MaxPerOwner)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
