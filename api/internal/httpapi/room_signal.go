package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

// WebSocket signaling cho WebRTC P2P (SP024 / STR114 / Task163).
//
// Chỉ SDP/ICE đi qua đây. Server KHÔNG đọc nội dung, KHÔNG lưu, KHÔNG ghi log message: nội dung
// message có thể là SQL của người dùng nên nó không được xuất hiện ở bất kỳ dòng log nào
// (Core Rule 7, AC4). Đây là lý do tệp này không có lời gọi log nào nhận message.
//
// Signaling state is ephemeral; resets on server restart. Peers re-dial on reconnect.

const (
	// maxSignalBytes là trần MỘT message. Vượt thì coder/websocket tự đóng kết nối mã 1009.
	maxSignalBytes = 64 << 10
	// maxRoomPeers chặn một phòng chiếm hết RAM Gin. Phòng = cloud project; phòng thật của
	// STR113 là 2 editor + 2 viewer, nên 16 chừa chỗ cho tab/máy phụ mà vẫn có trần.
	maxRoomPeers = 16
	// signalLifetime đóng socket cũ: Render free ngủ sau 15 phút và không giữ socket vô hạn,
	// nên kết nối phải có hạn. Client mở lại khi cần (signaling state là tạm thời).
	signalLifetime = 30 * time.Minute
	// signalSendBuffer là hàng đợi ghi của mỗi peer; đầy thì bỏ message, xem relay.
	signalSendBuffer = 16
)

// signalHub giữ các peer đang mở theo phòng. Một mutex cho cả bản đồ: số phòng nhỏ, và mọi
// thao tác đều O(số peer trong phòng).
type signalHub struct {
	mu    sync.Mutex
	rooms map[string]map[*signalPeer]struct{}
}

func newSignalHub() *signalHub {
	return &signalHub{rooms: map[string]map[*signalPeer]struct{}{}}
}

type signalPeer struct {
	conn     *websocket.Conn
	user     string
	send     chan []byte
	sendOnce sync.Once
	connOnce sync.Once
}

// closeSend đóng hàng đợi để goroutine ghi thoát. Chạy đúng một lần và chỉ trong lúc giữ h.mu,
// nên relay không bao giờ gửi vào một hàng đợi đã đóng.
func (p *signalPeer) closeSend() { p.sendOnce.Do(func() { close(p.send) }) }

// closeConn đóng kết nối với mã đã chọn. Phải gọi NGOÀI h.mu: Close chạy bắt tay đóng với hạn
// 5 giây, giữ khoá suốt thời gian đó thì một tab treo làm đứng signaling của mọi phòng. conn có
// thể còn nil khi Accept thất bại.
func (p *signalPeer) closeConn(code websocket.StatusCode) {
	p.connOnce.Do(func() {
		if p.conn != nil {
			_ = p.conn.Close(code, "")
		}
	})
}

// join giữ chỗ cho peer; false khi phòng đã đủ maxRoomPeers.
func (h *signalHub) join(room string, p *signalPeer) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	peers := h.rooms[room]
	if len(peers) >= maxRoomPeers {
		return false
	}
	if peers == nil {
		peers = map[*signalPeer]struct{}{}
		h.rooms[room] = peers
	}
	peers[p] = struct{}{}
	return true
}

// leave xoá peer khỏi phòng và xoá luôn phòng khi rỗng, trong một lần giữ khóa. Không xoá phòng
// rỗng thì bản đồ phình theo số lần vào/ra phòng (AC6).
//
// Việc đóng kết nối làm SAU khi nhả khóa: `Conn.Close` chạy bắt tay đóng với hạn 5 giây, nên giữ
// khóa suốt lúc đó sẽ chặn relay của mọi phòng chỉ vì một client không đọc. Đóng hàng đợi gửi thì
// vẫn phải trong khóa, nếu không relay có thể gửi vào channel đã đóng.
func (h *signalHub) leave(room string, p *signalPeer, code websocket.StatusCode) {
	h.mu.Lock()
	peers := h.rooms[room]
	delete(peers, p)
	if len(peers) == 0 {
		delete(h.rooms, room)
	}
	p.closeSend()
	h.mu.Unlock()
	p.closeConn(code)
}

// relay chuyển tiếp nguyên byte cho các peer khác trong cùng phòng, hoặc chỉ cho peer có user id
// bằng `to`. Server không diễn giải SDP/ICE và không đệm lịch sử: peer vào sau không nhận lại
// message cũ.
func (h *signalHub) relay(room string, from *signalPeer, to string, data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for p := range h.rooms[room] {
		if p == from || (to != "" && p.user != to) {
			continue
		}
		select {
		case p.send <- data:
		default:
			// shortcut: peer nhận chậm thì bỏ message đó (WebRTC tự xin lại offer), nâng cấp
			// sang hàng đợi có trần + đóng peer khi người dùng thật gặp mất gói.
		}
	}
}

// size là số peer đang mở của một phòng. Test AC6 đọc hàm này thay vì đoán.
func (h *signalHub) size(room string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms[room])
}

// RoomSignalConfig nối handler với phần đăng nhập, giống CloudConfig: httpapi không import được
// package auth (auth đã import httpapi).
type RoomSignalConfig struct {
	Store       *store.Store
	RequireUser gin.HandlerFunc
	UID         func(*gin.Context) string
	// Origin là origin công khai của web (PUBLIC_ORIGIN). Cần vì request đi qua rewrite của
	// Next: Host là host của Gin còn Origin là host Vercel, nên kiểm same-origin mặc định của
	// coder/websocket sẽ từ chối. Rỗng thì giữ kiểm mặc định (gọi thẳng Gin ở máy).
	Origin string
}

// MountRoomSignal đăng ký /api/v1/cloud/projects/:id/signal. Phải gọi sau auth.Mount để hưởng
// originCheck của các route đổi trạng thái.
func MountRoomSignal(r *gin.Engine, cfg RoomSignalConfig) {
	mountRoomSignal(r, cfg, newSignalHub(), signalLifetime)
}

// mountRoomSignal nhận hub và hạn sống từ ngoài để test đo được trần thời gian sống mà không
// phải chờ 30 phút. Route và hành vi không đổi.
func mountRoomSignal(r *gin.Engine, cfg RoomSignalConfig, hub *signalHub, lifetime time.Duration) {
	h := &signalHandler{hub: hub, s: cfg.Store, uid: cfg.UID, origin: cfg.Origin, lifetime: lifetime}
	if h.uid == nil {
		h.uid = func(*gin.Context) string { return "" }
	}
	guard := cfg.RequireUser
	if guard == nil {
		// Thiếu middleware đăng nhập thì đóng route, không mở socket cho danh tính rỗng.
		guard = func(c *gin.Context) {
			Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
		}
	}
	r.GET("/api/v1/cloud/projects/:id/signal", guard, h.signal)
}

type signalHandler struct {
	hub      *signalHub
	s        *store.Store
	uid      func(*gin.Context) string
	origin   string
	lifetime time.Duration
}

func (h *signalHandler) signal(c *gin.Context) {
	uid := h.uid(c)
	if uid == "" {
		Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
		return
	}
	if h.s == nil {
		Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
		return
	}
	room := c.Param("id")
	if !cloudIDRe.MatchString(room) {
		Abort(c, http.StatusBadRequest, codeCloudInvalidID, "error.badRequest")
		return
	}
	allowed, err := h.canJoin(c.Request.Context(), uid, room)
	if err != nil {
		// Chỉ loại lỗi, không nội dung: thông điệp pgx có thể mang giá trị cột (Core Rule 7).
		log.Printf("signal: access check failed (%T)", err)
		Abort(c, http.StatusInternalServerError, "internal", "error.internal")
		return
	}
	if !allowed {
		// 404 chứ không 403: không lộ dự án có tồn tại hay không, giống route cloud.
		Abort(c, http.StatusNotFound, codeCloudNotFound, "error.notFound")
		return
	}

	p := &signalPeer{user: uid, send: make(chan []byte, signalSendBuffer)}
	if !h.hub.join(room, p) {
		Abort(c, http.StatusTooManyRequests, "room_full", "error.rateLimited")
		return
	}
	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{OriginPatterns: h.originPatterns()})
	if err != nil {
		h.hub.leave(room, p, websocket.StatusNormalClosure)
		return // Accept đã tự ghi phản hồi lỗi (400/403)
	}
	p.conn = conn
	// Hạn sống: đóng bằng close frame thật (1001 Going Away) để client biết phải mở lại. Đóng
	// bằng hạn của context thì thư viện cắt kết nối thẳng, client chỉ thấy EOF không có mã.
	stopLifetime := time.AfterFunc(h.lifetime, func() { p.closeConn(websocket.StatusGoingAway) })
	defer stopLifetime.Stop()
	ctx := c.Request.Context()
	go h.write(ctx, p)
	code := h.read(ctx, p, room)
	h.hub.leave(room, p, code)
}

// canJoin kiểm người dùng có quyền vào phòng: owner hoặc thành viên của dự án.
//
// Điều kiện owner/thành viên viết thẳng trong câu lệnh chứ không phó mặc RLS: RLS là lớp thứ
// hai, còn tài khoản chạy migration/CI là superuser nên bỏ qua RLS — dựa một mình vào RLS thì
// test sẽ xanh giả và người ngoài vẫn vào được nếu role đổi. Không có nội dung message nào ở
// đây, chỉ có id dự án và id người dùng.
func (h *signalHandler) canJoin(ctx context.Context, uid, room string) (bool, error) {
	var ok bool
	err := h.s.WithTenant(ctx, uid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM cloud_projects p
			 WHERE p.id = $1
			   AND (p.owner_id = $2
			        OR EXISTS (SELECT 1 FROM cloud_project_members m
			                    WHERE m.project_id = p.id AND m.user_id = $2)))`, room, uid).Scan(&ok)
	})
	return ok, err
}

// originPatterns trả host của PUBLIC_ORIGIN cho coder/websocket so với header Origin.
func (h *signalHandler) originPatterns() []string {
	if h.origin == "" {
		return nil
	}
	u, err := url.Parse(h.origin)
	if err != nil || u.Host == "" {
		return nil
	}
	return []string{u.Host}
}

// read là vòng đọc duy nhất của một peer. Trả mã đóng để người gọi đóng kết nối đúng lý do;
// mọi đường thoát đều đi qua leave của signal nên peer bị xoá khỏi hub.
func (h *signalHandler) read(ctx context.Context, p *signalPeer, room string) websocket.StatusCode {
	p.conn.SetReadLimit(maxSignalBytes)
	for {
		typ, data, err := p.conn.Read(ctx)
		if err != nil {
			// Read tự đóng kết nối với mã thật (1009 khi vượt trần, 1000 khi client đóng);
			// ở đây chỉ cần một mã vô hại cho lần Close còn lại.
			return websocket.StatusNormalClosure
		}
		var env struct {
			To string `json:"to"`
		}
		if typ != websocket.MessageText || json.Unmarshal(data, &env) != nil {
			return websocket.StatusInvalidFramePayloadData
		}
		h.hub.relay(room, p, env.To, data)
	}
}

// write là goroutine ghi duy nhất của một peer: nhiều goroutine không cùng ghi một *websocket.Conn.
func (h *signalHandler) write(ctx context.Context, p *signalPeer) {
	for data := range p.send {
		if err := p.conn.Write(ctx, websocket.MessageText, data); err != nil {
			p.conn.CloseNow()
			return
		}
	}
}
