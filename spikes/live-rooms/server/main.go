// Spike Task159: server fan-out cho Live Rooms. KHÔNG dùng cho production.
//
// Mục đích duy nhất: đo byte ra, số request, số kết nối SSE và thời điểm nhả kết nối
// khi 30 viewer cùng xem một phòng. Không có auth, không có quota, không có DB.
//
// Payload phòng là chuỗi base64url do host phát lên (đúng định dạng codec SP022).
// Server KHÔNG đọc nội dung payload; nó chỉ chuyển tiếp nguyên chuỗi.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// Trần cứng của spike: chỉ để không nhận rác vô hạn. Cố ý đặt CAO hơn 32 KB của codec
// để đo được chuyện gì xảy ra khi phía phát gửi payload vượt trần (AC1, ca biên).
const maxPayloadBytes = 4 << 20

type snapshot struct {
	Version  int    `json:"v"`
	Payload  string `json:"payload"`
	SQLBytes int    `json:"sqlBytes"` // số byte SQL người dùng nằm trong payload, do host khai
	Bytes    int    `json:"bytes"`    // len(payload)
	HasPlan  bool   `json:"hasPlan"`
	Rows     int    `json:"rows"`
}

type closeEvent struct {
	ID       int64 `json:"id"`
	OpenedAt int64 `json:"openedAt"`
	ClosedAt int64 `json:"closedAt"`
	LivedMs  int64 `json:"livedMs"`
	Events   int64 `json:"events"`
}

type room struct {
	mu      sync.Mutex
	cur     snapshot
	subs    map[int64]chan snapshot
	nextSub int64
}

func newRoom() *room { return &room{subs: map[int64]chan snapshot{}} }

type counters struct {
	mu     sync.Mutex
	req    map[string]int64
	bytes  map[string]int64
	status map[string]int64
}

func newCounters() *counters {
	return &counters{req: map[string]int64{}, bytes: map[string]int64{}, status: map[string]int64{}}
}

func (c *counters) add(route string, n int64, status int) {
	c.mu.Lock()
	c.req[route]++
	c.bytes[route] += n
	c.status[route+"_"+strconv.Itoa(status)]++
	c.mu.Unlock()
}

// addBytes cộng byte ngay khi ghi ra socket, tách khỏi add() vì add() chốt lúc handler xong.
func (c *counters) addBytes(route string, n int64) {
	c.mu.Lock()
	c.bytes[route] += n
	c.mu.Unlock()
}

// countingWriter đếm byte thân phản hồi thật đã ghi ra socket (sau khi Gin viết).
// Cộng dồn NGAY khi ghi, không đợi handler trả về: với SSE, handler chỉ trả về lúc viewer
// ngắt kết nối, nên nếu đợi thì mọi phép đo trong lúc stream đang mở đều đọc được số 0.
type countingWriter struct {
	gin.ResponseWriter
	route string
	ctr   *counters
	live  *int64
}

func (w *countingWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	if n > 0 {
		atomic.AddInt64(w.live, int64(n))
		w.ctr.addBytes(w.route, int64(n))
	}
	return n, err
}

func (w *countingWriter) WriteString(s string) (int, error) {
	n, err := w.ResponseWriter.WriteString(s)
	if n > 0 {
		atomic.AddInt64(w.live, int64(n))
		w.ctr.addBytes(w.route, int64(n))
	}
	return n, err
}

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":18160"
	}
	heartbeatMs := 15000
	if v := os.Getenv("SSE_HEARTBEAT_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			heartbeatMs = n
		}
	}

	r := gin.New()
	r.Use(gin.Recovery())

	rooms := map[string]*room{}
	var roomsMu sync.Mutex
	getRoom := func(id string) *room {
		roomsMu.Lock()
		defer roomsMu.Unlock()
		rm, ok := rooms[id]
		if !ok {
			rm = newRoom()
			rooms[id] = rm
		}
		return rm
	}

	ctr := newCounters()
	var sseOpen int64
	var sseTotal int64
	var sseEvents int64
	closes := struct {
		mu sync.Mutex
		v  []closeEvent
	}{}

	// count bọc một handler để đếm byte thân phản hồi theo route.
	count := func(route string, h gin.HandlerFunc) gin.HandlerFunc {
		return func(c *gin.Context) {
			var n int64
			c.Writer = &countingWriter{ResponseWriter: c.Writer, route: route, ctr: ctr, live: &n}
			h(c)
			// Byte đã cộng dần trong lúc ghi; ở đây chỉ chốt request + status.
			ctr.mu.Lock()
			ctr.req[route]++
			ctr.status[route+"_"+strconv.Itoa(c.Writer.Status())]++
			ctr.mu.Unlock()
		}
	}

	r.GET("/healthz", count("healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "t": time.Now().UnixMilli()})
	}))

	// Host phát một phiên bản mới. Không kiểm nội dung payload.
	r.POST("/room/:id/publish", count("publish", func(c *gin.Context) {
		var in snapshot
		body := http.MaxBytesReader(c.Writer, c.Request.Body, maxPayloadBytes+1024)
		if err := json.NewDecoder(body).Decode(&in); err != nil {
			c.JSON(413, gin.H{"error": "payload_too_large_or_bad_json"})
			return
		}
		if len(in.Payload) > maxPayloadBytes {
			c.JSON(413, gin.H{"error": "payload_too_large"})
			return
		}
		rm := getRoom(c.Param("id"))
		rm.mu.Lock()
		rm.cur.Version++
		in.Version = rm.cur.Version
		in.Bytes = len(in.Payload)
		rm.cur = in
		subs := make([]chan snapshot, 0, len(rm.subs))
		for _, ch := range rm.subs {
			subs = append(subs, ch)
		}
		rm.mu.Unlock()

		atomic.AddInt64(&sseEvents, int64(len(subs)))
		for _, ch := range subs {
			select {
			case ch <- in:
			default: // viewer chậm: bỏ nhịp này, giống hành vi broker thật
			}
		}
		c.JSON(200, gin.H{"v": in.Version, "bytes": in.Bytes})
	}))

	// Polling: viewer hỏi "có gì mới không". Trùng phiên bản thì trả 304, không thân.
	r.GET("/room/:id/poll", count("poll", func(c *gin.Context) {
		rm := getRoom(c.Param("id"))
		rm.mu.Lock()
		cur := rm.cur
		rm.mu.Unlock()
		c.Header("Cache-Control", "no-store")
		c.Header("ETag", `"v`+strconv.Itoa(cur.Version)+`"`)
		want, _ := strconv.Atoi(c.Query("v"))
		if cur.Version == 0 {
			c.Status(204)
			return
		}
		if want == cur.Version {
			c.Status(304)
			return
		}
		c.JSON(200, cur)
	}))

	// Lấy nguyên payload của một phiên bản.
	r.GET("/room/:id/snapshot", count("snapshot", func(c *gin.Context) {
		rm := getRoom(c.Param("id"))
		rm.mu.Lock()
		cur := rm.cur
		rm.mu.Unlock()
		c.Header("Cache-Control", "no-store")
		c.Header("ETag", `"v`+strconv.Itoa(cur.Version)+`"`)
		want, _ := strconv.Atoi(c.Query("v"))
		if want == cur.Version && cur.Version != 0 {
			c.Status(304)
			return
		}
		if cur.Version == 0 {
			c.Status(204)
			return
		}
		c.JSON(200, cur)
	}))

	// SSE: giữ một kết nối, đẩy nguyên payload mỗi lần host phát.
	r.GET("/room/:id/events", count("events", func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("Content-Type", "text/event-stream")
		// `no-transform` là thứ thật sự cấm proxy nén lại. Tham số `nt=0` để đo xem khi
		// THIẾU header này thì Next có gom đệm stream hay không — không có phép so đó thì
		// không nói được `compress: false` có bắt buộc hay không.
		if c.Query("nt") != "0" {
			h.Set("Cache-Control", "no-cache, no-transform")
		} else {
			h.Set("Cache-Control", "no-cache")
		}
		h.Set("X-Accel-Buffering", "no")
		h.Set("Connection", "keep-alive")

		rm := getRoom(c.Param("id"))
		id := atomic.AddInt64(&sseTotal, 1)
		ch := make(chan snapshot, 8)
		rm.mu.Lock()
		rm.subs[id] = ch
		cur := rm.cur
		rm.mu.Unlock()

		opened := time.Now()
		atomic.AddInt64(&sseOpen, 1)
		var sent int64
		defer func() {
			rm.mu.Lock()
			delete(rm.subs, id)
			rm.mu.Unlock()
			atomic.AddInt64(&sseOpen, -1)
			closes.mu.Lock()
			closes.v = append(closes.v, closeEvent{
				ID: id, OpenedAt: opened.UnixMilli(), ClosedAt: time.Now().UnixMilli(),
				LivedMs: time.Since(opened).Milliseconds(), Events: atomic.LoadInt64(&sent),
			})
			if len(closes.v) > 200 {
				closes.v = closes.v[len(closes.v)-200:]
			}
			closes.mu.Unlock()
		}()

		c.Writer.WriteHeader(200)
		c.Writer.Flush()
		// Bản tin chào: cho viewer biết phiên bản hiện tại ngay khi nối.
		c.SSEvent("hello", gin.H{"v": cur.Version})
		c.Writer.Flush()

		hb := time.NewTicker(time.Duration(heartbeatMs) * time.Millisecond)
		defer hb.Stop()
		for {
			select {
			case <-c.Request.Context().Done():
				return
			case s := <-ch:
				c.SSEvent("snapshot", s)
				c.Writer.Flush()
				atomic.AddInt64(&sent, 1)
			case <-hb.C:
				c.SSEvent("ping", gin.H{"t": time.Now().UnixMilli()})
				c.Writer.Flush()
			}
		}
	}))

	r.GET("/metrics", func(c *gin.Context) {
		ctr.mu.Lock()
		req := make(map[string]int64, len(ctr.req))
		by := make(map[string]int64, len(ctr.bytes))
		st := make(map[string]int64, len(ctr.status))
		for k, v := range ctr.req {
			req[k] = v
		}
		for k, v := range ctr.bytes {
			by[k] = v
		}
		for k, v := range ctr.status {
			st[k] = v
		}
		ctr.mu.Unlock()
		closes.mu.Lock()
		cl := make([]closeEvent, len(closes.v))
		copy(cl, closes.v)
		closes.mu.Unlock()
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		c.JSON(200, gin.H{
			"requests":   req,
			"bytes":      by,
			"status":     st,
			"sseOpen":    atomic.LoadInt64(&sseOpen),
			"sseTotal":   atomic.LoadInt64(&sseTotal),
			"sseEvents":  atomic.LoadInt64(&sseEvents),
			"closes":     cl,
			"goroutines": runtime.NumGoroutine(),
			"heapSys":    ms.HeapSys,
			"heapAlloc":  ms.HeapAlloc,
		})
	})

	r.POST("/metrics/reset", func(c *gin.Context) {
		ctr.mu.Lock()
		ctr.req = map[string]int64{}
		ctr.bytes = map[string]int64{}
		ctr.status = map[string]int64{}
		ctr.mu.Unlock()
		closes.mu.Lock()
		closes.v = nil
		closes.mu.Unlock()
		c.JSON(200, gin.H{"ok": true})
	})

	log.Printf("live-rooms spike server on %s (heartbeat %d ms)", addr, heartbeatMs)
	if err := r.Run(addr); err != nil {
		panic(err)
	}
}
