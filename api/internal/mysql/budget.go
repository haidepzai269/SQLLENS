package mysql

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Budget tracks how long one user's statements have run today. Both calls fail closed:
// an error means the caller must refuse the request.
type Budget interface {
	Spent(ctx context.Context, uid string) (time.Duration, error)
	Add(ctx context.Context, uid string, d time.Duration) error
}

const budgetWindow = 24 * time.Hour

type upstashBudget struct {
	url, token string
	hc         *http.Client
}

func NewUpstashBudget(restURL, token string) Budget {
	return &upstashBudget{url: strings.TrimRight(restURL, "/"), token: token, hc: &http.Client{
		Timeout:       2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func budgetKey(uid string) string {
	h := sha256.Sum256([]byte("mysql_exec_ms\x00" + uid))
	return "quota:" + hex.EncodeToString(h[:])
}

// Add increments and sets the TTL on first write (or if a key lost its TTL).
const addScript = `local c=redis.call('INCRBY',KEYS[1],ARGV[1])
if redis.call('PTTL',KEYS[1])<0 then redis.call('PEXPIRE',KEYS[1],ARGV[2]) end
return c`

func (b *upstashBudget) cmd(ctx context.Context, args ...any) (json.RawMessage, error) {
	body, _ := json.Marshal(args)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.url, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("bad request")
	}
	req.Header.Set("Authorization", "Bearer "+b.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.hc.Do(req)
	if err != nil {
		return nil, errors.New("upstash unreachable")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err != nil || resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &out) != nil || out.Error != "" {
		return nil, errors.New("upstash bad reply")
	}
	return out.Result, nil
}

func (b *upstashBudget) Spent(ctx context.Context, uid string) (time.Duration, error) {
	r, err := b.cmd(ctx, "GET", budgetKey(uid))
	if err != nil {
		return 0, err
	}
	if string(r) == "null" {
		return 0, nil
	}
	var s string // GET returns a string
	if json.Unmarshal(r, &s) != nil {
		return 0, errors.New("upstash bad reply")
	}
	ms, err := strconv.ParseInt(s, 10, 64)
	if err != nil || ms < 0 {
		return 0, errors.New("upstash bad reply")
	}
	return time.Duration(ms) * time.Millisecond, nil
}

func (b *upstashBudget) Add(ctx context.Context, uid string, d time.Duration) error {
	_, err := b.cmd(ctx, "EVAL", addScript, "1", budgetKey(uid), strconv.FormatInt(d.Milliseconds(), 10), strconv.FormatInt(budgetWindow.Milliseconds(), 10))
	return err
}
