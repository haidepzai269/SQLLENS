// Package mysql forwards a signed-in user's MySQL sandbox requests from Gin to the sandbox agent
// over pinned HTTPS. Session state stays in the agent, so a Render restart loses nothing.
// It logs nothing about requests: SQL, results, the token and the user id must not reach logs.
//
// Per-user limits (Task037 asked for all three before the port opens). Numbers assume the Azure
// machine runs 2 sessions at once and each statement is cut at 15 s by the agent:
//   - Concurrent sessions: 1 per user. Enforced by the agent (MAX_PER_OWNER=1, atomic with session
//     creation, survives Render restarts). With 2 slots, one user must not hold both.
//   - Statement rate: 20 per minute per user (QueryRule), Upstash. Enough for a lock-wait demo that
//     alternates two connections, and caps the load one user can put on 2 vCPUs.
//   - Total statement time: 10 minutes per user per 24 h (DailyBudget), Upstash. At 20 sessions per
//     day this is 30 s per session on average; a deliberate SLEEP counts, so a user cannot pin the box.
//
// Upstash errors refuse the request (fail closed).
package mysql

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/haidepzai269/SQLLENS/api/internal/auth"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
)

var QueryRule = quota.Rule{Name: "mysql_query", Limit: 20, Window: time.Minute}

const (
	DailyBudget = 10 * time.Minute
	maxBody     = 1 << 20
)

var idRe = regexp.MustCompile(`^[0-9a-f]{30}$`)

type handler struct {
	c      *client
	budget Budget
	uid    func(*gin.Context) string // auth.UserID; tests swap it
}

var queryTimeout = 30 * time.Second

// Mount registers the /mysql/sessions routes. Each route takes its own quota rule from a.Gate.
func Mount(r *gin.Engine, a *auth.Auth, cfg Config, budget Budget) {
	routes(r, a.Gate, &handler{c: newClient(cfg), budget: budget, uid: auth.UserID})
}

func routes(r *gin.Engine, gate func(quota.Rule) []gin.HandlerFunc, h *handler) {
	g := r.Group("/mysql/sessions")
	g.POST("", chain(gate(quota.MySQLSession), h.configured, h.create)...)
	g.POST("/:id/query", chain(gate(QueryRule), h.configured, h.query)...)
	g.GET("/:id/locks", chain(gate(QueryRule), h.configured, h.locks)...)
	g.DELETE("/:id", chain(gate(QueryRule), h.configured, h.del)...)
}

// chain runs configured first, so a missing config never spends the user's quota.
func chain(gate []gin.HandlerFunc, cfg gin.HandlerFunc, rest ...gin.HandlerFunc) []gin.HandlerFunc {
	return append(append([]gin.HandlerFunc{cfg}, gate...), rest...)
}

func (h *handler) configured(c *gin.Context) {
	if h.c == nil || h.budget == nil {
		httpapi.Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
	}
}

func notFound(c *gin.Context) {
	httpapi.Abort(c, http.StatusNotFound, "session_not_found", "sandbox.sessionNotFound")
}

// relay passes the agent's answer through. Statuses and bodies keep the agent's contract; anything
// that is not a JSON answer from the agent (auth failure, redirect, junk) becomes a Gin error.
func relay(c *gin.Context, status int, body []byte, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		c.AbortWithStatus(499) // browser left; the outgoing request was cancelled with it
	case errors.Is(err, context.DeadlineExceeded):
		httpapi.Abort(c, http.StatusGatewayTimeout, "sandbox_timeout", "sandbox.timeout")
	case errors.Is(err, errTooLarge):
		httpapi.Abort(c, http.StatusUnprocessableEntity, "result_too_large", "sandbox.resultTooLarge")
	case err != nil:
		log.Print("mysql: sandbox unreachable") // never log err: it can carry the URL
		httpapi.Abort(c, http.StatusBadGateway, "sandbox_unreachable", "sandbox.unreachable")
	case status == http.StatusNoContent:
		c.Status(status)
	case status < 200 || status > 599 || (status >= 300 && status < 400) || status == http.StatusUnauthorized || !json.Valid(body):
		log.Printf("mysql: sandbox bad answer status=%d", status)
		httpapi.Abort(c, http.StatusBadGateway, "sandbox_bad_response", "sandbox.badResponse")
	default:
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(status, "application/json", body)
	}
}

func (h *handler) create(c *gin.Context) {
	st, body, err := h.c.do(c.Request.Context(), http.MethodPost, "/sessions", h.uid(c), nil, 60*time.Second)
	relay(c, st, body, err)
}

func (h *handler) locks(c *gin.Context) {
	id := c.Param("id")
	if !idRe.MatchString(id) {
		notFound(c)
		return
	}
	st, body, err := h.c.do(c.Request.Context(), http.MethodGet, "/sessions/"+id+"/locks", h.uid(c), nil, 15*time.Second)
	relay(c, st, body, err)
}

func (h *handler) del(c *gin.Context) {
	id := c.Param("id")
	if !idRe.MatchString(id) {
		notFound(c)
		return
	}
	st, body, err := h.c.do(c.Request.Context(), http.MethodDelete, "/sessions/"+id, h.uid(c), nil, 70*time.Second)
	relay(c, st, body, err)
}

type queryReq struct {
	SQL        string `json:"sql"`
	Connection string `json:"connection,omitempty"`
}

func (h *handler) query(c *gin.Context) {
	id, uid := c.Param("id"), h.uid(c)
	if !idRe.MatchString(id) {
		notFound(c)
		return
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpapi.Abort(c, http.StatusRequestEntityTooLarge, "payload_too_large", "error.payloadTooLarge")
		} else {
			httpapi.Abort(c, http.StatusBadRequest, "bad_request", "error.badRequest")
		}
		return
	}
	var req queryReq
	dec := json.NewDecoder(&buf)
	dec.DisallowUnknownFields()
	if dec.Decode(&req) != nil || dec.More() || !utf8.ValidString(req.SQL) || strings.TrimSpace(req.SQL) == "" ||
		(req.Connection != "" && req.Connection != "a" && req.Connection != "b") {
		httpapi.Abort(c, http.StatusBadRequest, "bad_request", "error.badRequest")
		return
	}
	spent, err := h.budget.Spent(c.Request.Context(), uid)
	if err != nil {
		log.Print("mysql: time budget unavailable")
		httpapi.Abort(c, http.StatusServiceUnavailable, "quota_unavailable", "error.quotaUnavailable")
		return
	}
	if spent >= DailyBudget {
		httpapi.Abort(c, http.StatusTooManyRequests, "mysql_time_exhausted", "error.mysqlTimeExhausted")
		return
	}
	out, _ := json.Marshal(req)
	t0 := time.Now()
	st, body, err := h.c.do(c.Request.Context(), http.MethodPost, "/sessions/"+id+"/query", uid, out, queryTimeout)
	// Charge even when the browser left or the call failed: the agent may still have run the statement.
	// Detached context, so a cancelled request still gets billed.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 2*time.Second)
	defer cancel()
	if e := h.budget.Add(ctx, uid, max(time.Since(t0), time.Millisecond)); e != nil {
		log.Print("mysql: time budget write failed")
	}
	relay(c, st, body, err)
}
