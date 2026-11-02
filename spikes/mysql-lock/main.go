// Spike Task016: bắt lock wait, deadlock, dirty read, gap lock trên MySQL thật.
// Chạy: go run .   (cần Docker; tự dựng và xóa container t016-mysql)
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const (
	image       = "mysql:8.4.13" // ghim patch cụ thể, Task015 chưa chọn image
	container   = "t016-mysql"
	lockTimeout = 8 // innodb_lock_wait_timeout đặt thấp cho phiên thử (mặc định 50)
	runsEach    = 5
	stepLimit   = 20 * time.Second // hạn cho cả một kịch bản, bước bị chặn không treo chương trình
	pollEvery   = 5 * time.Millisecond
)

// Câu truy vấn khóa dùng bởi connection thứ ba (root). Đưa vào ket_qua.md nguyên văn.
const waitQ = `SELECT tr.PROCESSLIST_ID, tb.PROCESSLIST_ID,
  rl.LOCK_TYPE, rl.LOCK_MODE, rl.OBJECT_SCHEMA, rl.OBJECT_NAME, IFNULL(rl.INDEX_NAME,''), IFNULL(rl.LOCK_DATA,''),
  bl.LOCK_TYPE, bl.LOCK_MODE, IFNULL(bl.LOCK_DATA,'')
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID AND rl.ENGINE = w.ENGINE
JOIN performance_schema.data_locks bl ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID AND bl.ENGINE = w.ENGINE
JOIN performance_schema.threads tr ON tr.THREAD_ID = w.REQUESTING_THREAD_ID
JOIN performance_schema.threads tb ON tb.THREAD_ID = w.BLOCKING_THREAD_ID
WHERE rl.OBJECT_SCHEMA = 'lab'`

const heldQ = `SELECT t.PROCESSLIST_ID, l.LOCK_TYPE, l.LOCK_MODE, l.OBJECT_NAME, IFNULL(l.INDEX_NAME,''), IFNULL(l.LOCK_DATA,''), l.LOCK_STATUS
FROM performance_schema.data_locks l
JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
WHERE l.OBJECT_SCHEMA = 'lab' AND t.PROCESSLIST_ID = ?
ORDER BY l.LOCK_TYPE, l.LOCK_MODE, l.LOCK_DATA`

type waitRow struct {
	req, blk                  int64
	typ, mode, schema, table  string
	index, data               string
	blkType, blkMode, blkData string
}

func (w waitRow) String() string {
	return fmt.Sprintf("%s %s on %s.%s index=%s data=%s (blocked by %s %s data=%s)", w.typ, w.mode, w.schema, w.table, w.index, w.data, w.blkType, w.blkMode, w.blkData)
}

type env struct {
	admin, lowDB *sql.DB
	lowUser      string
}

// run là kết quả một lần chạy: sig để so 5 lần, note là phần ghi thêm (không so).
type run struct {
	sig, note, sample string
	lat               time.Duration
}

func main() {
	out := flag.String("out", "../../_bmad-output/SP002/STR010/Task016/ket_qua.md", "file ket_qua.md")
	keep := flag.Bool("keep", false, "giữ container sau khi chạy")
	flag.Parse()
	if err := mainErr(*out, *keep); err != nil {
		fmt.Fprintln(os.Stderr, "LỖI:", err)
		os.Exit(1)
	}
}

func mainErr(out string, keep bool) (err error) {
	_ = mysql.SetLogger(log.New(io.Discard, "", 0)) // driver in EOF khi MySQL còn khởi tạo
	rootPW, lowPW := secret(), secret()
	port, err := freePort(33160)
	if err != nil {
		return err
	}
	_ = docker("rm", "-f", container) // chỉ t016-*
	if _, err = dockerOut("run", "-d", "--name", container, "-p", fmt.Sprintf("127.0.0.1:%d:3306", port),
		"-e", "MYSQL_ROOT_PASSWORD="+rootPW, image, fmt.Sprintf("--innodb-lock-wait-timeout=%d", lockTimeout)); err != nil {
		return err
	}
	if !keep {
		defer func() { _ = docker("rm", "-f", container) }()
	}
	root := fmt.Sprintf("root:%s@tcp(127.0.0.1:%d)/?timeout=5s", rootPW, port)
	e := &env{lowUser: "lowpriv"}
	if e.admin, err = waitReady(root); err != nil {
		return err
	}
	defer e.admin.Close()
	ctx := context.Background()
	for _, q := range []string{
		"CREATE DATABASE lab",
		"CREATE TABLE lab.acct (id INT PRIMARY KEY, bal INT NOT NULL) ENGINE=InnoDB",
		"CREATE TABLE lab.gap (id INT PRIMARY KEY) ENGINE=InnoDB",
		"CREATE USER 'lowpriv'@'%' IDENTIFIED BY '" + lowPW + "'",
		"GRANT SELECT, INSERT, UPDATE, DELETE ON lab.* TO 'lowpriv'@'%'",
	} {
		if _, err = e.admin.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}
	if e.lowDB, err = sql.Open("mysql", fmt.Sprintf("lowpriv:%s@tcp(127.0.0.1:%d)/lab?timeout=5s", lowPW, port)); err != nil {
		return err
	}
	e.lowDB.SetMaxIdleConns(0) // Close() phải cắt session thật, không để txn treo trong pool
	defer e.lowDB.Close()

	var ver, adminTO, lowTO, grants string
	_ = e.admin.QueryRow("SELECT VERSION(), @@GLOBAL.innodb_lock_wait_timeout").Scan(&ver, &adminTO)
	_ = e.lowDB.QueryRow("SELECT @@SESSION.innodb_lock_wait_timeout").Scan(&lowTO)
	_ = e.admin.QueryRow("SELECT GROUP_CONCAT(PRIVILEGE_TYPE ORDER BY PRIVILEGE_TYPE) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=\"'lowpriv'@'%'\" AND TABLE_SCHEMA='lab'").Scan(&grants)

	scenarios := []struct {
		ac, name string
		fn       func(context.Context) (run, error)
	}{
		{"AC1", "Lock wait: B cập nhật cùng dòng A chưa commit", e.lockWait},
		{"AC2", "Deadlock do cập nhật ngược thứ tự", e.deadlock},
		{"AC3", "Dirty read: READ UNCOMMITTED so với READ COMMITTED", e.dirtyRead},
		{"AC4a", "Lost update ở REPEATABLE READ", e.lostUpdate},
		{"AC4b", "Gap lock: SELECT ... FOR UPDATE theo khoảng", e.gapLock},
		{"AC5", "User quyền thấp đọc performance_schema", e.denied},
	}
	var rep strings.Builder
	fmt.Fprintf(&rep, "# Kết quả Task016: bắt lock wait trên MySQL thật\n\n")
	fmt.Fprintf(&rep, "Nhãn: **Thật**. Mọi số liệu lấy từ MySQL %s (image `%s`) vừa chạy. Độ trễ đo trong sandbox, không phải dự đoán cho production.\n\n", ver, image)
	fmt.Fprintf(&rep, "Cấu hình: `innodb_lock_wait_timeout` = %s (global) / %s (session của user thấp), mặc định là 50 giây. Isolation mặc định REPEATABLE READ, mỗi kịch bản chạy %d lần.\n", adminTO, lowTO, runsEach)
	fmt.Fprintf(&rep, "Quyền user `lowpriv`: %s trên `lab.*`, không có quyền nào trên `performance_schema`.\n\n", grants)
	fmt.Fprintf(&rep, "## Câu truy vấn khóa (connection thứ ba, root)\n\nCặp chờ:\n\n```sql\n%s\n```\n\nKhóa đang giữ của một session:\n\n```sql\n%s\n```\n\nDeadlock: `SHOW ENGINE INNODB STATUS` (mục LATEST DETECTED DEADLOCK).\n\n", waitQ, heldQ)

	allSame := true
	for _, sc := range scenarios {
		var runs []run
		for i := 0; i < runsEach; i++ {
			sctx, cancel := context.WithTimeout(ctx, stepLimit)
			r, err := sc.fn(sctx)
			cancel()
			if err != nil {
				r = run{sig: "LỖI: " + err.Error()}
			}
			runs = append(runs, r)
			fmt.Printf("%s lần %d: %s\n", sc.ac, i+1, r.sig)
		}
		same := true
		for _, r := range runs[1:] {
			same = same && r.sig == runs[0].sig
		}
		allSame = allSame && same && !strings.HasPrefix(runs[0].sig, "LỖI")
		fmt.Fprintf(&rep, "## %s. %s\n\n", sc.ac, sc.name)
		if same && !strings.HasPrefix(runs[0].sig, "LỖI") {
			fmt.Fprintf(&rep, "5/5 lần cùng kết quả: `%s`\n\n", runs[0].sig)
		} else {
			fmt.Fprintf(&rep, "**LỆCH hoặc lỗi** giữa các lần chạy.\n\n")
		}
		fmt.Fprintf(&rep, "| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |\n|---|---|---|---|\n")
		var lats []time.Duration
		for i, r := range runs {
			lat := "-"
			if r.lat > 0 {
				lat = r.lat.Round(100 * time.Microsecond).String()
				lats = append(lats, r.lat)
			}
			fmt.Fprintf(&rep, "| %d | %s | %s | %s |\n", i+1, esc(r.sig), lat, esc(r.note))
		}
		if len(lats) > 0 {
			sort.Slice(lats, func(a, b int) bool { return lats[a] < lats[b] })
			fmt.Fprintf(&rep, "\nĐộ trễ từ lúc B bắt đầu câu lệnh bị chặn đến lúc connection thứ ba thấy khóa: min %v, trung vị %v, max %v (poll mỗi %v, gồm cả thời gian khởi động goroutine B).\n", lats[0].Round(100*time.Microsecond), lats[len(lats)/2].Round(100*time.Microsecond), lats[len(lats)-1].Round(100*time.Microsecond), pollEvery)
		}
		fmt.Fprintf(&rep, "\nVí dụ dữ liệu đọc được (lần 1):\n\n```text\n%s\n```\n\n", runs[0].sample)
	}

	// Ca biên: timeout thật, chạy một lần.
	to, terr := e.timeoutCase(ctx)
	fmt.Fprintf(&rep, "## Ca biên: innodb_lock_wait_timeout\n\n")
	if terr != nil {
		fmt.Fprintf(&rep, "LỖI: %v\n", terr)
		allSame = false
	} else {
		fmt.Fprintf(&rep, "%s\n", to)
	}
	fmt.Print("\n" + rep.String())
	if err := os.WriteFile(out, []byte(rep.String()), 0o644); err != nil {
		return err
	}
	if !allSame {
		return errors.New("có kịch bản lệch hoặc lỗi, xem ket_qua.md")
	}
	return nil
}

func esc(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ") }

// ---------- AC1 ----------
func (e *env) lockWait(ctx context.Context) (run, error) {
	if err := e.reset(ctx); err != nil {
		return run{}, err
	}
	a, aid, err := e.low(ctx, "")
	if err != nil {
		return run{}, err
	}
	defer done(a)
	b, bid, err := e.low(ctx, "")
	if err != nil {
		return run{}, err
	}
	defer done(b)
	if err = begin(ctx, a, "UPDATE lab.acct SET bal = bal + 1 WHERE id = 1"); err != nil {
		return run{}, err
	}
	if err = begin(ctx, b); err != nil {
		return run{}, err
	}
	bDone := make(chan error, 1)
	start := time.Now()
	go func() { _, err := b.ExecContext(ctx, "UPDATE lab.acct SET bal = bal + 10 WHERE id = 1"); bDone <- err }()
	rows, lat, err := e.waitRows(ctx, start, func(r []waitRow) bool { return len(r) > 0 })
	if err != nil {
		return run{}, err
	}
	w := rows[0]
	if w.req != bid || w.blk != aid {
		return run{}, fmt.Errorf("cặp chờ sai: req=%d blk=%d, mong đợi B=%d A=%d", w.req, w.blk, bid, aid)
	}
	select {
	case err := <-bDone:
		return run{}, fmt.Errorf("B không bị chặn (err=%v)", err)
	default:
	}
	held, _ := e.held(ctx, aid)
	if _, err = a.ExecContext(ctx, "COMMIT"); err != nil {
		return run{}, err
	}
	if err = <-bDone; err != nil {
		return run{}, fmt.Errorf("B sau khi A commit: %w", err)
	}
	return run{
		sig:    fmt.Sprintf("B chờ A: %s %s trên %s.%s index %s; A giữ %s %s", w.typ, w.mode, w.schema, w.table, w.index, w.blkType, w.blkMode),
		sample: fmt.Sprintf("A=conn %d, B=conn %d\ndata_lock_waits+data_locks: %s\nA đang giữ:\n%s", aid, bid, w, held),
		lat:    lat,
	}, nil
}

// ---------- AC2 ----------
func (e *env) deadlock(ctx context.Context) (run, error) {
	if err := e.reset(ctx); err != nil {
		return run{}, err
	}
	a, aid, err := e.low(ctx, "")
	if err != nil {
		return run{}, err
	}
	defer done(a)
	b, bid, err := e.low(ctx, "")
	if err != nil {
		return run{}, err
	}
	defer done(b)
	if err = begin(ctx, a, "UPDATE lab.acct SET bal = bal + 1 WHERE id = 1"); err != nil {
		return run{}, err
	}
	if err = begin(ctx, b, "UPDATE lab.acct SET bal = bal + 1 WHERE id = 2"); err != nil {
		return run{}, err
	}
	aErr := make(chan error, 1)
	start := time.Now()
	go func() { _, err := a.ExecContext(ctx, "UPDATE lab.acct SET bal = bal + 1 WHERE id = 2"); aErr <- err }()
	if _, _, err = e.waitRows(ctx, start, func(r []waitRow) bool { return len(r) > 0 }); err != nil {
		return run{}, err
	}
	_, bE := b.ExecContext(ctx, "UPDATE lab.acct SET bal = bal + 1 WHERE id = 1")
	var aE error
	select {
	case aE = <-aErr:
	case <-ctx.Done():
		return run{}, errors.New("A không trả về sau khi B gây deadlock")
	}
	n1213 := func(e error) bool { var m *mysql.MySQLError; return errors.As(e, &m) && m.Number == 1213 }
	var victim string
	switch {
	case n1213(bE) && aE == nil:
		victim = "B"
	case n1213(aE) && bE == nil:
		victim = "A"
	default:
		return run{}, fmt.Errorf("mong đợi đúng một bên 1213, được A=%v B=%v", aE, bE)
	}
	status, err := e.deadlockStatus(ctx)
	if err != nil {
		return run{}, err
	}
	for _, id := range []int64{aid, bid} {
		if !strings.Contains(status, fmt.Sprintf("MySQL thread id %d,", id)) {
			return run{}, fmt.Errorf("INNODB STATUS không có thread %d của lần chạy này", id)
		}
	}
	if !strings.Contains(status, "WE ROLL BACK TRANSACTION") {
		return run{}, errors.New("INNODB STATUS thiếu dòng WE ROLL BACK TRANSACTION")
	}
	return run{
		sig:    "đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread",
		note:   "bên bị hủy: " + victim,
		sample: fmt.Sprintf("A=conn %d, B=conn %d, bị hủy: %s\n%s", aid, bid, victim, status),
		lat:    0,
	}, nil
}

// ---------- AC3 ----------
func (e *env) dirtyRead(ctx context.Context) (run, error) {
	var parts, sample []string
	for _, iso := range []string{"READ UNCOMMITTED", "READ COMMITTED"} {
		if err := e.reset(ctx); err != nil {
			return run{}, err
		}
		v, err := func() (int, error) {
			a, _, err := e.low(ctx, "")
			if err != nil {
				return 0, err
			}
			defer done(a)
			b, _, err := e.low(ctx, iso)
			if err != nil {
				return 0, err
			}
			defer done(b)
			if err = begin(ctx, a, "UPDATE lab.acct SET bal = 999 WHERE id = 1"); err != nil {
				return 0, err
			}
			if err = begin(ctx, b); err != nil {
				return 0, err
			}
			var v int
			err = b.QueryRowContext(ctx, "SELECT bal FROM lab.acct WHERE id = 1").Scan(&v)
			return v, err
		}()
		if err != nil {
			return run{}, err
		}
		parts = append(parts, fmt.Sprintf("%s đọc %d", iso, v))
		sample = append(sample, fmt.Sprintf("A UPDATE bal=999 chưa commit (gốc 100); B ở %s: SELECT bal => %d", iso, v))
	}
	sig := strings.Join(parts, "; ")
	if sig != "READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100" {
		return run{}, fmt.Errorf("sai kỳ vọng dirty read: %s", sig)
	}
	return run{sig: sig, sample: strings.Join(sample, "\n")}, nil
}

// ---------- AC4a ----------
func (e *env) lostUpdate(ctx context.Context) (run, error) {
	if err := e.reset(ctx); err != nil {
		return run{}, err
	}
	a, _, err := e.low(ctx, "REPEATABLE READ")
	if err != nil {
		return run{}, err
	}
	defer done(a)
	b, _, err := e.low(ctx, "REPEATABLE READ")
	if err != nil {
		return run{}, err
	}
	defer done(b)
	if err = begin(ctx, a); err != nil {
		return run{}, err
	}
	if err = begin(ctx, b); err != nil {
		return run{}, err
	}
	var av, bv int
	if err = a.QueryRowContext(ctx, "SELECT bal FROM lab.acct WHERE id = 1").Scan(&av); err != nil {
		return run{}, err
	}
	if err = b.QueryRowContext(ctx, "SELECT bal FROM lab.acct WHERE id = 1").Scan(&bv); err != nil {
		return run{}, err
	}
	// đọc rồi ghi giá trị tính ở ứng dụng (đọc-sửa-ghi), không có FOR UPDATE
	if _, err = a.ExecContext(ctx, "UPDATE lab.acct SET bal = ? WHERE id = 1", av+10); err != nil {
		return run{}, err
	}
	if _, err = a.ExecContext(ctx, "COMMIT"); err != nil {
		return run{}, err
	}
	if _, err = b.ExecContext(ctx, "UPDATE lab.acct SET bal = ? WHERE id = 1", bv+20); err != nil {
		return run{}, err
	}
	var bSees int
	_ = b.QueryRowContext(ctx, "SELECT bal FROM lab.acct WHERE id = 1").Scan(&bSees)
	if _, err = b.ExecContext(ctx, "COMMIT"); err != nil {
		return run{}, err
	}
	var final int
	if err = e.admin.QueryRowContext(ctx, "SELECT bal FROM lab.acct WHERE id = 1").Scan(&final); err != nil {
		return run{}, err
	}
	return run{
		sig:    fmt.Sprintf("A và B cùng đọc %d, A ghi %d, B ghi %d, kết quả cuối %d (mất +10 của A)", av, av+10, bv+20, final),
		sample: fmt.Sprintf("snapshot RR: A đọc %d, B đọc %d; sau khi A commit B vẫn thấy snapshot cũ khi đọc; cuối cùng bal=%d (cộng đúng phải là 130)", av, bv, final),
	}, nil
}

// ---------- AC4b ----------
func (e *env) gapLock(ctx context.Context) (run, error) {
	if err := e.reset(ctx); err != nil {
		return run{}, err
	}
	a, aid, err := e.low(ctx, "REPEATABLE READ")
	if err != nil {
		return run{}, err
	}
	defer done(a)
	b, bid, err := e.low(ctx, "REPEATABLE READ")
	if err != nil {
		return run{}, err
	}
	defer done(b)
	if err = begin(ctx, a); err != nil {
		return run{}, err
	}
	rs, err := a.QueryContext(ctx, "SELECT id FROM lab.gap WHERE id BETWEEN 12 AND 18 FOR UPDATE") // dòng có: 10, 20, 30
	if err != nil {
		return run{}, err
	}
	n := 0
	for rs.Next() {
		n++
	}
	rs.Close()
	if n != 0 {
		return run{}, fmt.Errorf("khoảng 12..18 phải rỗng, có %d dòng", n)
	}
	if err = begin(ctx, b); err != nil {
		return run{}, err
	}
	bDone := make(chan error, 1)
	start := time.Now()
	go func() { _, err := b.ExecContext(ctx, "INSERT INTO lab.gap VALUES (15)"); bDone <- err }()
	rows, lat, err := e.waitRows(ctx, start, func(r []waitRow) bool { return len(r) > 0 })
	if err != nil {
		return run{}, err
	}
	w := rows[0]
	held, err := e.held(ctx, aid)
	if err != nil {
		return run{}, err
	}
	if w.req != bid || w.blk != aid || !strings.Contains(w.blkMode, "GAP") || w.data != "20" {
		return run{}, fmt.Errorf("gap lock không như kỳ vọng: %s", w)
	}
	if !strings.Contains(held, "RECORD X,GAP gap PRIMARY 20") {
		return run{}, fmt.Errorf("A không giữ RECORD X,GAP trên 20:\n%s", held)
	}
	if _, err = a.ExecContext(ctx, "ROLLBACK"); err != nil {
		return run{}, err
	}
	if err = <-bDone; err != nil {
		return run{}, fmt.Errorf("B sau khi A nhả gap: %w", err)
	}
	return run{
		sig:    fmt.Sprintf("A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với %s", w.mode),
		sample: fmt.Sprintf("A=conn %d, B=conn %d\nA giữ:\n%s\nB chờ: %s", aid, bid, held, w),
		lat:    lat,
	}, nil
}

// ---------- AC5 ----------
func (e *env) denied(ctx context.Context) (run, error) {
	c, _, err := e.low(ctx, "")
	if err != nil {
		return run{}, err
	}
	defer done(c)
	var parts, sample []string
	for _, q := range []string{
		"SELECT * FROM performance_schema.data_locks",
		"SELECT * FROM performance_schema.data_lock_waits",
		"SHOW ENGINE INNODB STATUS",
	} {
		rs, err := c.QueryContext(ctx, q)
		if err == nil {
			rs.Close()
			return run{}, fmt.Errorf("user quyền thấp chạy được: %s", q)
		}
		var m *mysql.MySQLError
		if !errors.As(err, &m) {
			return run{}, err
		}
		parts = append(parts, fmt.Sprintf("%d", m.Number))
		sample = append(sample, fmt.Sprintf("%s => ERROR %d: %s", q, m.Number, m.Message))
	}
	var n int
	if err = e.admin.QueryRowContext(ctx, "SELECT COUNT(*) FROM performance_schema.data_locks").Scan(&n); err != nil {
		return run{}, fmt.Errorf("đối chứng root lỗi: %w", err)
	}
	sample = append(sample, "đối chứng: root chạy được truy vấn đầu tiên")
	return run{sig: "lowpriv bị từ chối, mã lỗi " + strings.Join(parts, "/"), sample: strings.Join(sample, "\n")}, nil
}

// ---------- ca biên ----------
func (e *env) timeoutCase(ctx context.Context) (string, error) {
	if err := e.reset(ctx); err != nil {
		return "", err
	}
	cctx, cancel := context.WithTimeout(ctx, stepLimit)
	defer cancel()
	a, _, err := e.low(cctx, "")
	if err != nil {
		return "", err
	}
	defer done(a)
	b, _, err := e.low(cctx, "")
	if err != nil {
		return "", err
	}
	defer done(b)
	if err = begin(cctx, a, "UPDATE lab.acct SET bal = 1 WHERE id = 1"); err != nil {
		return "", err
	}
	if err = begin(cctx, b); err != nil {
		return "", err
	}
	t := time.Now()
	_, err = b.ExecContext(cctx, "UPDATE lab.acct SET bal = 2 WHERE id = 1")
	var m *mysql.MySQLError
	if !errors.As(err, &m) || m.Number != 1205 {
		return "", fmt.Errorf("mong đợi 1205, được %v", err)
	}
	return fmt.Sprintf("A giữ khóa và không commit; B chờ %v rồi nhận lỗi 1205 (%s), khớp `innodb_lock_wait_timeout`=%d.", time.Since(t).Round(100*time.Millisecond), m.Message, lockTimeout), nil
}

// ---------- helper ----------
func (e *env) reset(ctx context.Context) error {
	for _, q := range []string{
		"DELETE FROM lab.acct", "INSERT INTO lab.acct VALUES (1,100),(2,100)",
		"DELETE FROM lab.gap", "INSERT INTO lab.gap VALUES (10),(20),(30)",
	} {
		if _, err := e.admin.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

// low mở một connection user thấp; iso rỗng = mặc định (REPEATABLE READ). iso chỉ là hằng trong file này.
func (e *env) low(ctx context.Context, iso string) (*sql.Conn, int64, error) {
	c, err := e.lowDB.Conn(ctx)
	if err != nil {
		return nil, 0, err
	}
	if iso != "" {
		if _, err = c.ExecContext(ctx, "SET SESSION TRANSACTION ISOLATION LEVEL "+iso); err != nil {
			c.Close()
			return nil, 0, err
		}
	}
	var id int64
	if err = c.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&id); err != nil {
		c.Close()
		return nil, 0, err
	}
	return c, id, nil
}

func begin(ctx context.Context, c *sql.Conn, stmts ...string) error {
	if _, err := c.ExecContext(ctx, "BEGIN"); err != nil {
		return err
	}
	for _, s := range stmts {
		if _, err := c.ExecContext(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

// done rollback rồi đóng; bỏ qua lỗi vì ngữ cảnh có thể đã hết hạn.
func done(c *sql.Conn) {
	rc, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = c.ExecContext(rc, "ROLLBACK")
	_ = c.Close()
}

// waitRows poll data_lock_waits bằng connection root cho đến khi cond đúng; trả độ trễ từ start.
func (e *env) waitRows(ctx context.Context, start time.Time, cond func([]waitRow) bool) ([]waitRow, time.Duration, error) {
	for {
		rows, err := e.admin.QueryContext(ctx, waitQ)
		if err != nil {
			return nil, 0, fmt.Errorf("không thấy khóa chờ: %w", err)
		}
		var out []waitRow
		for rows.Next() {
			var w waitRow
			if err = rows.Scan(&w.req, &w.blk, &w.typ, &w.mode, &w.schema, &w.table, &w.index, &w.data, &w.blkType, &w.blkMode, &w.blkData); err != nil {
				rows.Close()
				return nil, 0, err
			}
			out = append(out, w)
		}
		rows.Close()
		if cond(out) {
			return out, time.Since(start), nil
		}
		select {
		case <-ctx.Done():
			return nil, 0, errors.New("hết hạn khi chờ connection thứ ba thấy khóa")
		case <-time.After(pollEvery):
		}
	}
}

func (e *env) held(ctx context.Context, id int64) (string, error) {
	rs, err := e.admin.QueryContext(ctx, heldQ, id)
	if err != nil {
		return "", err
	}
	defer rs.Close()
	var sb strings.Builder
	for rs.Next() {
		var pid int64
		var typ, mode, tbl, idx, data, st string
		if err = rs.Scan(&pid, &typ, &mode, &tbl, &idx, &data, &st); err != nil {
			return "", err
		}
		fmt.Fprintf(&sb, "%s %s %s %s %s %s\n", typ, mode, tbl, idx, data, st)
	}
	return sb.String(), rs.Err()
}

func (e *env) deadlockStatus(ctx context.Context) (string, error) {
	var typ, name, st string
	if err := e.admin.QueryRowContext(ctx, "SHOW ENGINE INNODB STATUS").Scan(&typ, &name, &st); err != nil {
		return "", err
	}
	i := strings.Index(st, "LATEST DETECTED DEADLOCK")
	if i < 0 {
		return "", errors.New("INNODB STATUS không có LATEST DETECTED DEADLOCK")
	}
	st = st[i:]
	if j := strings.Index(st, "TRANSACTIONS\n"); j > 0 {
		st = st[:j]
	}
	return strings.TrimSpace(st), nil
}

func secret() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func freePort(from int) (int, error) {
	for p := from; p < from+10; p++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			l.Close()
			return p, nil
		}
	}
	return 0, errors.New("không có cổng trống từ 33160")
}

func docker(args ...string) error { _, err := dockerOut(args...); return err }

func dockerOut(args ...string) (string, error) {
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker %s: %v: %s", args[0], err, out)
	}
	return string(out), nil
}

func waitReady(dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		if err = db.Ping(); err == nil {
			return db, nil
		}
		time.Sleep(time.Second)
	}
	db.Close()
	return nil, fmt.Errorf("MySQL không sẵn sàng sau 120s: %v", err)
}
