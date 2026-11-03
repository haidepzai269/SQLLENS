package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
)

var (
	errBusy     = errors.New("connection_busy")
	errTimeout  = errors.New("query_timeout")
	errDiskFull = errors.New("session_disk_quota")
	errLost     = errors.New("connection_lost")
)

type QueryResult struct {
	Columns      []string `json:"columns"`
	Rows         [][]any  `json:"rows"`
	AffectedRows *int64   `json:"affectedRows,omitempty"`
}

type queryResponse struct {
	Results   []QueryResult `json:"results"`
	Truncated bool          `json:"truncated"`
}

// userConn giữ một kết nối sqllens_user trong suốt phiên (a hoặc b), nên transaction mở dở vẫn còn giữa các yêu cầu.
type userConn struct {
	run  sync.Mutex // mỗi kết nối chạy một câu một lúc; kết nối kia vẫn chạy song song
	db   *sql.DB
	c    *sql.Conn
	id   int64
	mu   sync.Mutex // done: chặn KILL đến muộn rơi vào câu kế tiếp
	done bool
}

func (m *manager) rootDB(s *session) (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.root == nil {
		db, err := m.be.open(s.id, "root")
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(2)
		s.root = db
	}
	return s.root, nil
}

func slot(s *session, name string) *userConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	cn := s.cn[name]
	if cn == nil {
		cn = &userConn{}
		s.cn[name] = cn
	}
	return cn
}

// ensure mở kết nối thật nếu chưa có. Gọi khi đang giữ cn.run.
func (m *manager) ensure(s *session, cn *userConn) error {
	if cn.c != nil {
		return nil
	}
	if cn.db == nil {
		db, err := m.be.open(s.id, "user")
		if err != nil {
			return err
		}
		db.SetMaxOpenConns(1)
		cn.db = db
		s.mu.Lock()
		closed := s.closed
		s.mu.Unlock()
		if closed { // phiên bị hủy trong lúc mở
			db.Close()
			cn.db = nil
			return errNotFound
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, err := cn.db.Conn(ctx)
	if err != nil {
		return err
	}
	var id int64
	if err := c.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&id); err != nil {
		c.Close()
		return err
	}
	cn.c, cn.id = c, id
	return nil
}

// Query chạy SQL người dùng qua driver (không qua client mysql) trên kết nối a hoặc b của phiên.
func (m *manager) Query(s *session, name, query string) (*queryResponse, error) {
	cn := slot(s, name)
	if !cn.run.TryLock() {
		return nil, errBusy
	}
	defer cn.run.Unlock()
	if err := m.ensure(s, cn); err != nil {
		return nil, errLost
	}

	cn.mu.Lock()
	cn.done = false
	cn.mu.Unlock()
	var timedOut bool
	timer := time.AfterFunc(m.cfg.QueryTimeout, func() {
		cn.mu.Lock()
		defer cn.mu.Unlock()
		if !cn.done {
			timedOut = true
			m.kill(s, cn.id)
		}
	})
	// Không truyền context có hạn: driver sẽ đóng cả kết nối khi hết hạn, mất transaction. KILL QUERY chỉ cắt câu.
	resp, err := m.readAll(s, cn, query)
	timer.Stop()
	cn.mu.Lock()
	cn.done = true
	wasTimeout := timedOut
	cn.mu.Unlock()

	if err != nil {
		if wasTimeout {
			return nil, errTimeout
		}
		if r := s.why(); r == "disk_quota" {
			return nil, errDiskFull
		}
		var me *mysql.MySQLError
		if !errors.As(err, &me) { // đứt kết nối: bỏ kết nối này, lần sau mở lại
			cn.c.Close()
			cn.c = nil
			return nil, errLost
		}
		return nil, err
	}
	return resp, nil
}

func (m *manager) kill(s *session, id int64) {
	db, err := m.rootDB(s)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db.ExecContext(ctx, fmt.Sprintf("KILL QUERY %d", id)) // id là số do server trả, không phải chuỗi người dùng
}

func (m *manager) readAll(s *session, cn *userConn, query string) (*queryResponse, error) {
	rows, err := cn.c.QueryContext(context.Background(), query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resp := &queryResponse{Results: []QueryResult{}}
	total, bytes := 0, 0
	for {
		cols, err := rows.Columns()
		if err != nil {
			return nil, err
		}
		rs := QueryResult{Columns: cols, Rows: [][]any{}}
		for len(cols) > 0 && rows.Next() {
			if total >= m.cfg.MaxRows || bytes > m.cfg.MaxCellBytes {
				resp.Truncated = true
				m.kill(s, cn.id) // ngắt phần còn lại trước khi Close, vì Close phải đọc hết
				break
			}
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				return nil, err
			}
			for i := range vals {
				vals[i] = cell(vals[i])
				if str, ok := vals[i].(string); ok {
					bytes += len(str)
				}
			}
			rs.Rows = append(rs.Rows, vals)
			total++
		}
		resp.Results = append(resp.Results, rs)
		if resp.Truncated {
			rows.Close()
			return resp, nil
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		if !rows.NextResultSet() {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// shortcut: driver không đưa RowsAffected qua Rows; chỉ lấy cho kết quả cuối khi nó không có cột. Câu giữa lô không có.
	if last := &resp.Results[len(resp.Results)-1]; len(last.Columns) == 0 {
		var n int64
		if err := cn.c.QueryRowContext(context.Background(), "SELECT ROW_COUNT()").Scan(&n); err == nil && n >= 0 {
			last.AffectedRows = &n
		}
	}
	return resp, nil
}

// cell đổi giá trị driver thành kiểu JSON an toàn: byte thành chuỗi UTF-8, số nguyên quá 2^53 thành chuỗi.
func cell(v any) any {
	switch x := v.(type) {
	case []byte:
		return strings.ToValidUTF8(string(x), "�")
	case string:
		if !utf8.ValidString(x) {
			return strings.ToValidUTF8(x, "�")
		}
	case int64:
		if x > 1<<53 || x < -(1<<53) {
			return strconv.FormatInt(x, 10)
		}
	case uint64:
		if x > 1<<53 {
			return strconv.FormatUint(x, 10)
		}
	}
	return v
}

// Locks đọc chờ khóa và khóa đang giữ bằng root. Câu cố định, không có chuỗi người dùng.
func (m *manager) Locks(s *session) (map[string]any, error) {
	db, err := m.rootDB(s)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	waits, err := tableOf(ctx, db, `SELECT tr.PROCESSLIST_ID AS requesting_conn, tb.PROCESSLIST_ID AS blocking_conn,
  rl.LOCK_TYPE AS requesting_lock_type, rl.LOCK_MODE AS requesting_lock_mode, rl.OBJECT_NAME AS object_name, IFNULL(rl.INDEX_NAME,'') AS index_name, IFNULL(rl.LOCK_DATA,'') AS requesting_lock_data,
  bl.LOCK_TYPE AS blocking_lock_type, bl.LOCK_MODE AS blocking_lock_mode, IFNULL(bl.LOCK_DATA,'') AS blocking_lock_data
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID AND rl.ENGINE = w.ENGINE
JOIN performance_schema.data_locks bl ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID AND bl.ENGINE = w.ENGINE
JOIN performance_schema.threads tr ON tr.THREAD_ID = w.REQUESTING_THREAD_ID
JOIN performance_schema.threads tb ON tb.THREAD_ID = w.BLOCKING_THREAD_ID
WHERE rl.OBJECT_SCHEMA = 'app'`)
	if err != nil {
		return nil, err
	}
	locks, err := tableOf(ctx, db, `SELECT t.PROCESSLIST_ID AS conn, l.LOCK_TYPE AS lock_type, l.LOCK_MODE AS lock_mode, l.OBJECT_NAME AS object_name,
  IFNULL(l.INDEX_NAME,'') AS index_name, IFNULL(l.LOCK_DATA,'') AS lock_data, l.LOCK_STATUS AS lock_status
FROM performance_schema.data_locks l
JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
WHERE l.OBJECT_SCHEMA = 'app' ORDER BY t.PROCESSLIST_ID, l.LOCK_TYPE, l.LOCK_MODE, l.LOCK_DATA`)
	if err != nil {
		return nil, err
	}
	conns := map[string]int64{}
	s.mu.Lock()
	for name, c := range s.cn {
		if c.c != nil {
			conns[name] = c.id
		}
	}
	s.mu.Unlock()
	return map[string]any{"waits": waits, "locks": locks, "connections": conns}, nil
}

func tableOf(ctx context.Context, db *sql.DB, q string) (QueryResult, error) {
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return QueryResult{}, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	rs := QueryResult{Columns: cols, Rows: [][]any{}}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return QueryResult{}, err
		}
		for i := range vals {
			vals[i] = cell(vals[i])
		}
		rs.Rows = append(rs.Rows, vals)
	}
	return rs, rows.Err()
}
