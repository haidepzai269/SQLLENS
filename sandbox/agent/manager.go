package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"regexp"
	"sync"
	"time"
)

var (
	errFull     = errors.New("sandbox_full")
	errNotFound = errors.New("session_not_found")
	errDiskLow  = errors.New("disk_low")
)

var idRe = regexp.MustCompile(`^[0-9a-f]{30}$`)

type config struct {
	MaxSessions  int
	IdleTTL      time.Duration
	Tick         time.Duration // chu kỳ janitor: hết hạn và hạn mức đĩa
	QueryTimeout time.Duration
	DiskLimit    int64 // byte, tính theo block thật trên đĩa của thư mục phiên
	MaxRows      int
	MaxCellBytes int
	SessRoot     string
}

// backend là phần chạm vào máy thật (session.sh, docker, đĩa). Test thay bằng bản giả.
type backend struct {
	create  func(ctx context.Context, id string) error
	destroy func(id string)
	dirSize func(id string) int64
	// open mở kết nối tới phiên: root là quản trị, user là sqllens_user, đều qua unix socket của container.
	open func(id, who string) (*sql.DB, error)
	list func() []string // phiên còn sót (thư mục hoặc container), dùng lúc khởi động
}

type session struct {
	id         string
	ready      bool
	closed     bool
	reason     string
	lastActive time.Time
	cn         map[string]*userConn
	root       *sql.DB
	mu         sync.Mutex // bảo vệ các trường trên
}

type manager struct {
	cfg     config
	be      backend
	mu      sync.Mutex
	s       map[string]*session
	startMu sync.Mutex // khởi động tuần tự để không vượt RAM
}

func newManager(cfg config, be backend) *manager {
	return &manager{cfg: cfg, be: be, s: map[string]*session{}}
}

func short(id string) string {
	if len(id) < 6 {
		return id
	}
	return id[:6]
}

func newID() string {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// cleanupStale hủy mọi phiên còn sót sau khi agent chết. Phiên đang mở không sống qua lần khởi động lại
// (kết nối và transaction đã mất), nên dọn sạch rồi trả 404 là cách đơn giản và không để sót container.
func (m *manager) cleanupStale() {
	for _, id := range m.be.list() {
		m.be.destroy(id)
		log.Printf("event=stale_removed sid=%s", short(id))
	}
}

func (m *manager) Create() (*session, error) {
	m.mu.Lock()
	if len(m.s) >= m.cfg.MaxSessions { // gồm cả phiên đang khởi động và đang hủy
		m.mu.Unlock()
		return nil, errFull
	}
	s := &session{id: newID(), cn: map[string]*userConn{}}
	m.s[s.id] = s
	m.mu.Unlock()

	m.startMu.Lock()
	defer m.startMu.Unlock()
	t0 := time.Now()
	// Không dùng context của yêu cầu: client bỏ đi giữa chừng thì phiên vẫn được tạo rồi hết hạn như thường.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Second)
	defer cancel()
	if err := m.be.create(ctx, s.id); err != nil {
		m.be.destroy(s.id)
		m.mu.Lock()
		delete(m.s, s.id)
		m.mu.Unlock()
		log.Printf("event=create_failed sid=%s ms=%d", short(s.id), time.Since(t0).Milliseconds())
		return nil, err
	}
	s.mu.Lock()
	s.ready, s.lastActive = true, time.Now()
	s.mu.Unlock()
	log.Printf("event=created sid=%s ms=%d", short(s.id), time.Since(t0).Milliseconds())
	return s, nil
}

// Get trả phiên đang dùng được và gia hạn. Id sai, phiên chưa sẵn sàng, đã đóng: cùng một lỗi.
func (m *manager) Get(id string) (*session, error) {
	if !idRe.MatchString(id) {
		return nil, errNotFound
	}
	m.mu.Lock()
	s := m.s[id]
	m.mu.Unlock()
	if s == nil {
		return nil, errNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed {
		return nil, errNotFound
	}
	s.lastActive = time.Now()
	return s, nil
}

func (s *session) expiresAt(ttl time.Duration) time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastActive.Add(ttl)
}

// Remove hủy phiên. Slot chỉ được trả sau khi container đã biến mất.
func (m *manager) Remove(id, reason string) bool {
	m.mu.Lock()
	s := m.s[id]
	m.mu.Unlock()
	if s == nil {
		return false
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return false
	}
	s.closed, s.reason = true, reason
	s.mu.Unlock()
	t0 := time.Now()
	m.be.destroy(id) // trước, để câu đang chạy báo lỗi và nhả kết nối; db.Close chờ câu đang chạy
	s.mu.Lock()
	dbs := []*sql.DB{s.root}
	for _, c := range s.cn {
		dbs = append(dbs, c.db)
	}
	s.mu.Unlock()
	for _, d := range dbs {
		if d != nil {
			d.Close()
		}
	}
	m.mu.Lock()
	delete(m.s, id)
	m.mu.Unlock()
	log.Printf("event=removed sid=%s reason=%s ms=%d", short(id), reason, time.Since(t0).Milliseconds())
	return true
}

func (s *session) why() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reason
}

func (m *manager) janitor(ctx context.Context) {
	t := time.NewTicker(m.cfg.Tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.sweep()
		}
	}
}

func (m *manager) sweep() {
	type item struct {
		id     string
		reason string
	}
	var drop []item
	m.mu.Lock()
	for id, s := range m.s {
		s.mu.Lock()
		if s.ready && !s.closed {
			if time.Since(s.lastActive) > m.cfg.IdleTTL {
				drop = append(drop, item{id, "expired"})
			} else if m.be.dirSize(id) > m.cfg.DiskLimit {
				drop = append(drop, item{id, "disk_quota"})
			}
		}
		s.mu.Unlock()
	}
	m.mu.Unlock()
	for _, d := range drop {
		go m.Remove(d.id, d.reason)
	}
}
