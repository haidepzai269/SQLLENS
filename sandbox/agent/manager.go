package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"regexp"
	"sync"
	"time"
)

var (
	errFull      = errors.New("sandbox_full")
	errNotFound  = errors.New("session_not_found")
	errDiskLow   = errors.New("disk_low")
	errOwnerFull = errors.New("user_session_limit")
)

var idRe = regexp.MustCompile(`^[0-9a-f]{30}$`)

type config struct {
	MaxSessions  int
	MaxPerOwner  int // phiên đồng thời tối đa của một người dùng; 0 nghĩa là không giới hạn riêng
	IdleTTL      time.Duration
	Tick         time.Duration // chu kỳ janitor: hết hạn và hạn mức đĩa
	QueryTimeout time.Duration
	KillGrace    time.Duration // chờ sau KILL QUERY trước khi hủy phiên
	DiskLimit    int64         // byte, tính theo block thật trên đĩa của thư mục phiên
	MaxRows      int
	MaxCellBytes int
	SessRoot     string
}

// backend là phần chạm vào máy thật (session.sh, docker, đĩa). Test thay bằng bản giả.
type backend struct {
	create  func(ctx context.Context, id string) error
	destroy func(id string) error // nil khi container và thư mục đã biến mất
	dirSize func(id string) int64
	// open mở kết nối tới phiên: root là quản trị, user là sqllens_user, đều qua unix socket của container.
	open func(id, who string) (*sql.DB, error)
	list func() []string // phiên còn sót (thư mục hoặc container), dùng lúc khởi động
}

type session struct {
	id         string
	owner      string // SHA-256 (hex) của user id do Gin gửi; không lưu id gốc
	ready      bool
	closed     bool
	reason     string
	finishing  bool
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
		if m.be.destroy(id) != nil {
			log.Printf("event=stale_destroy_failed sid=%s", short(id))
			// giữ lại như phiên đã đóng để sweep thử hủy tiếp và slot không bị trả sớm
			m.s[id] = &session{id: id, closed: true, reason: "stale", cn: map[string]*userConn{}}
			continue
		}
		log.Printf("event=stale_removed sid=%s", short(id))
	}
}

func (m *manager) Create(owner string) (*session, error) {
	m.mu.Lock()
	if len(m.s) >= m.cfg.MaxSessions { // gồm cả phiên đang khởi động và đang hủy
		m.mu.Unlock()
		return nil, errFull
	}
	if lim := m.cfg.MaxPerOwner; lim > 0 && owner != "" {
		n := 0
		for _, o := range m.s {
			if o.owner == owner {
				n++
			}
		}
		if n >= lim { // kiểm cùng khóa với việc thêm phiên: hai yêu cầu đồng thời không cùng lọt
			m.mu.Unlock()
			return nil, errOwnerFull
		}
	}
	s := &session{id: newID(), owner: owner, cn: map[string]*userConn{}}
	m.s[s.id] = s
	m.mu.Unlock()

	m.startMu.Lock()
	defer m.startMu.Unlock()
	t0 := time.Now()
	// Không dùng context của yêu cầu: client bỏ đi giữa chừng thì phiên vẫn được tạo rồi hết hạn như thường.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Second)
	defer cancel()
	if err := m.be.create(ctx, s.id); err != nil {
		if m.be.destroy(s.id) == nil { // chưa xóa được thì giữ slot, sweep thử lại
			m.mu.Lock()
			delete(m.s, s.id)
			m.mu.Unlock()
		} else {
			s.mu.Lock()
			s.closed = true
			s.mu.Unlock()
		}
		log.Printf("event=create_failed sid=%s ms=%d", short(s.id), time.Since(t0).Milliseconds())
		return nil, err
	}
	s.mu.Lock()
	s.ready, s.lastActive = true, time.Now()
	s.mu.Unlock()
	log.Printf("event=created sid=%s ms=%d", short(s.id), time.Since(t0).Milliseconds())
	return s, nil
}

// Get trả phiên đang dùng được và gia hạn. Id sai, phiên chưa sẵn sàng, đã đóng, hoặc của người khác: cùng một lỗi.
func (m *manager) Get(id, owner string) (*session, error) {
	if !idRe.MatchString(id) {
		return nil, errNotFound
	}
	m.mu.Lock()
	s := m.s[id]
	m.mu.Unlock()
	if s == nil || owner == "" || subtle.ConstantTimeCompare([]byte(s.owner), []byte(owner)) != 1 {
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

// Remove hủy phiên. Slot chỉ được trả khi container đã biến mất; destroy lỗi thì phiên ở lại (closed) và sweep thử lại.
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
	m.finish(s, reason)
	return true
}

func (m *manager) finish(s *session, reason string) {
	s.mu.Lock()
	if s.finishing {
		s.mu.Unlock()
		return
	}
	s.finishing = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.finishing = false; s.mu.Unlock() }()
	t0 := time.Now()
	if err := m.be.destroy(s.id); err != nil { // trước, để câu đang chạy báo lỗi và nhả kết nối
		log.Printf("event=destroy_failed sid=%s reason=%s", short(s.id), reason)
		return
	}
	s.mu.Lock()
	dbs := []*sql.DB{s.root}
	conns := []*sql.Conn{}
	for _, c := range s.cn {
		dbs = append(dbs, c.db)
		if c.c != nil {
			conns = append(conns, c.c)
		}
	}
	s.mu.Unlock()
	for _, c := range conns {
		c.Close()
	}
	for _, d := range dbs {
		if d != nil {
			d.Close()
		}
	}
	m.mu.Lock()
	delete(m.s, s.id)
	m.mu.Unlock()
	log.Printf("event=removed sid=%s reason=%s ms=%d", short(s.id), reason, time.Since(t0).Milliseconds())
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
	m.mu.Lock()
	all := make([]*session, 0, len(m.s))
	for _, s := range m.s {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		s.mu.Lock()
		ready, closed, idle, reason := s.ready, s.closed, time.Since(s.lastActive) > m.cfg.IdleTTL, s.reason
		s.mu.Unlock()
		switch {
		case closed: // gồm phiên Create thất bại mà destroy lỗi (ready=false)
			go m.finish(s, reason+"_retry")
		case !ready:
		case idle:
			go m.Remove(s.id, "expired")
		default:
			if m.be.dirSize(s.id) > m.cfg.DiskLimit { // ngoài khóa: duyệt đĩa có thể chậm
				go m.Remove(s.id, "disk_quota")
			}
		}
	}
}
