package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const maxBody = 1 << 20

type server struct {
	m     *manager
	token [32]byte // SHA-256 của token: so sánh hai giá trị cùng độ dài, thời gian không phụ thuộc nội dung
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code, key string, detail any) {
	body := map[string]any{"error": map[string]string{"code": code, "messageKey": key}}
	if detail != nil {
		body["detail"] = detail
	}
	writeJSON(w, status, body)
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /sessions", s.create)
	mux.HandleFunc("POST /sessions/{id}/query", s.query)
	mux.HandleFunc("GET /sessions/{id}/locks", s.locks)
	mux.HandleFunc("DELETE /sessions/{id}", s.del)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, 404, "not_found", "error.notFound", nil)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t0 := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		if r.URL.Path != "/healthz" && !s.authorized(r) {
			fail(sw, 401, "unauthorized", "sandbox.unauthorized", nil)
		} else {
			r.Body = http.MaxBytesReader(sw, r.Body, maxBody)
			mux.ServeHTTP(sw, r)
		}
		// Chỉ method, mẫu route, mã trả về: đường dẫn thật chứa id phiên và body chứa SQL nên không ghi.
		pat := r.Pattern
		if pat == "" {
			pat = "unmatched"
		}
		log.Printf("event=http route=%q status=%d ms=%d", pat, sw.code, time.Since(t0).Milliseconds())
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(c int) { w.code = c; w.ResponseWriter.WriteHeader(c) }

func (s *server) authorized(r *http.Request) bool {
	h, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return false
	}
	sum := sha256.Sum256([]byte(h))
	return subtle.ConstantTimeCompare(sum[:], s.token[:]) == 1
}

func (s *server) create(w http.ResponseWriter, r *http.Request) {
	ses, err := s.m.Create()
	switch {
	case errors.Is(err, errFull):
		fail(w, 429, "sandbox_full", "sandbox.full", nil)
	case errors.Is(err, errDiskLow):
		fail(w, 503, "disk_low", "sandbox.diskLow", nil)
	case err != nil:
		fail(w, 500, "create_failed", "sandbox.createFailed", nil)
	default:
		writeJSON(w, 201, map[string]any{"id": ses.id, "expiresAt": ses.expiresAt(s.m.cfg.IdleTTL).UTC().Format(time.RFC3339)})
	}
}

func (s *server) session(w http.ResponseWriter, r *http.Request) *session {
	ses, err := s.m.Get(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "session_not_found", "sandbox.sessionNotFound", nil)
		return nil
	}
	return ses
}

func (s *server) query(w http.ResponseWriter, r *http.Request) {
	ses := s.session(w, r)
	if ses == nil {
		return
	}
	var req struct {
		SQL        string `json:"sql"`
		Connection string `json:"connection"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			fail(w, 413, "body_too_large", "sandbox.bodyTooLarge", nil)
		} else {
			fail(w, 400, "bad_request", "error.badRequest", nil)
		}
		return
	}
	if req.Connection == "" {
		req.Connection = "a"
	}
	if (req.Connection != "a" && req.Connection != "b") || strings.TrimSpace(req.SQL) == "" {
		fail(w, 400, "bad_request", "error.badRequest", nil)
		return
	}
	resp, err := s.m.Query(ses, req.Connection, req.SQL)
	var me *mysql.MySQLError
	switch {
	case err == nil:
		writeJSON(w, 200, resp)
	case errors.Is(err, errBusy):
		fail(w, 409, "connection_busy", "sandbox.connectionBusy", nil)
	case errors.Is(err, errTimeout):
		fail(w, 422, "query_timeout", "sandbox.queryTimeout", nil)
	case errors.Is(err, errDiskFull):
		fail(w, 422, "session_disk_quota", "sandbox.diskQuota", nil)
	case errors.Is(err, errLost):
		fail(w, 502, "connection_lost", "sandbox.connectionLost", nil)
	case errors.As(err, &me):
		// Thông báo của MySQL có thể trích lại SQL của chính người dùng; trả cho họ nhưng không ghi log.
		fail(w, 422, "sql_error", "sandbox.sqlError", map[string]any{"errno": me.Number, "sqlState": string(me.SQLState[:]), "message": me.Message})
	default:
		fail(w, 500, "internal", "error.internal", nil)
	}
}

func (s *server) locks(w http.ResponseWriter, r *http.Request) {
	ses := s.session(w, r)
	if ses == nil {
		return
	}
	out, err := s.m.Locks(ses)
	if err != nil {
		fail(w, 502, "locks_failed", "sandbox.locksFailed", nil)
		return
	}
	writeJSON(w, 200, out)
}

func (s *server) del(w http.ResponseWriter, r *http.Request) {
	ses := s.session(w, r)
	if ses == nil {
		return
	}
	s.m.Remove(ses.id, "deleted")
	w.WriteHeader(204)
}
