package mysql

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Config comes from SANDBOX_URL, SANDBOX_TOKEN, SANDBOX_CERT_SHA256. Any missing or malformed value
// means "not configured": MySQL routes answer 503 and the rest of the API keeps running.
type Config struct {
	URL, Token, CertSHA256 string
}

const (
	minTokenLen = 32
	// maxResp caps what we buffer from the agent. The agent already cuts at 10,000 rows; this keeps one
	// answer from filling Render's 512 MB RAM when rows are wide.
	maxResp = 2 << 20
)

var (
	errTooLarge = errors.New("response too large")
	errPin      = errors.New("sandbox certificate not pinned")
)

type client struct {
	base  *url.URL
	token string
	hc    *http.Client
}

// parsePin accepts 64 hex chars, with or without colons, any case.
func parsePin(s string) ([]byte, bool) {
	s = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), ":", ""))
	b, err := hex.DecodeString(s)
	return b, err == nil && len(b) == sha256.Size
}

// newClient returns nil when the config is incomplete or unsafe.
func newClient(cfg Config) *client {
	u, err := url.Parse(strings.TrimSpace(cfg.URL))
	pin, ok := parsePin(cfg.CertSHA256)
	// Only https, no credentials, no path/query: routes are appended to a bare origin.
	if err != nil || !ok || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || len(cfg.Token) < minTokenLen {
		return nil
	}
	u.Path, u.Fragment = "", ""
	tr := &http.Transport{
		Proxy:               nil, // never route the token through a proxy picked up from the environment
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
		MaxIdleConns:        4, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			// The cert is self-signed and has no usable name, so the chain/name check is replaced
			// by an exact fingerprint match plus a validity-window check. VerifyConnection still runs
			// with InsecureSkipVerify, and it runs before any HTTP byte (so before the token) is sent.
			InsecureSkipVerify: true,
			VerifyConnection: func(cs tls.ConnectionState) error {
				if len(cs.PeerCertificates) == 0 {
					return errPin
				}
				leaf := cs.PeerCertificates[0]
				sum := sha256.Sum256(leaf.Raw)
				now := time.Now()
				if subtle.ConstantTimeCompare(sum[:], pin) != 1 || now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
					return errPin
				}
				return nil
			},
		},
	}
	return &client{base: u, token: cfg.Token, hc: &http.Client{
		Transport: tr,
		// A redirect would carry the token to a place we did not choose.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// do calls the agent. It never logs: URL, headers and bodies hold the token, user id and SQL.
// A cancelled ctx (browser gone) aborts the outgoing request.
func (c *client) do(ctx context.Context, method, path, user string, body []byte, timeout time.Duration) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base.String()+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Sandbox-User", user)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResp+1))
	if err != nil {
		return 0, nil, err
	}
	if len(raw) > maxResp {
		return resp.StatusCode, nil, errTooLarge
	}
	return resp.StatusCode, raw, nil
}

// stream opens a streaming GET request to the sandbox agent (e.g. for SSE events).
func (c *client) stream(ctx context.Context, path, user string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base.String()+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Sandbox-User", user)
	req.Header.Set("Accept", "text/event-stream")
	return c.hc.Do(req)
}
