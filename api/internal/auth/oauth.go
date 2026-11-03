package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

// Điểm cuối thật; test ghi đè bằng Config.
var (
	googleEP = Endpoints{"https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://openidconnect.googleapis.com/v1/userinfo"}
	githubEP = Endpoints{"https://github.com/login/oauth/authorize", "https://github.com/login/oauth/access_token", "https://api.github.com/user"}
)

var scopes = map[string]string{"google": "openid profile email", "github": "read:user"}

func (a *Auth) provider(name string) (Provider, bool) {
	var p Provider
	var def Endpoints
	switch name {
	case "google":
		p, def = a.cfg.Google, googleEP
	case "github":
		p, def = a.cfg.GitHub, githubEP
	default:
		return Provider{}, false
	}
	if p.Auth == "" {
		p.Endpoints = def
	}
	return p, true
}

// safeNext chỉ nhận đường dẫn tương đối trong site. Mọi thứ khác về "/".
// Ký tự điều khiển bị loại vì trình duyệt bỏ tab và xuống dòng khi phân giải URL ("/\t/evil.com" thành "//evil.com").
func safeNext(s string) string {
	if len(s) == 0 || len(s) > 512 || s[0] != '/' || (len(s) > 1 && (s[1] == '/' || s[1] == '\\')) {
		return "/"
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] == 0x7f || s[i] == '\\' {
			return "/"
		}
	}
	if u, err := url.Parse(s); err != nil || u.Scheme != "" || u.Host != "" {
		return "/"
	}
	return s
}

// bindName: mỗi lần start một cookie riêng theo state, để hai tab đăng nhập cùng lúc không ghi đè nhau.
func bindName(state string) string {
	if len(state) > 16 {
		state = state[:16]
	}
	return bindCookie + "_" + state
}

func (a *Auth) redirectURI(provider string) string {
	return a.origin + "/api/auth/" + provider + "/callback"
}

func (a *Auth) ready(c *gin.Context) (string, Provider, bool) {
	name := c.Param("provider")
	p, ok := a.provider(name)
	if !ok {
		httpapi.Abort(c, http.StatusNotFound, "not_found", "error.notFound")
		return "", p, false
	}
	if a.origin == "" || a.store == nil || p.ClientID == "" || p.ClientSecret == "" {
		notConfigured(c)
		return "", p, false
	}
	return name, p, true
}

func (a *Auth) start(c *gin.Context) {
	name, p, ok := a.ready(c)
	if !ok {
		return
	}
	state, verifier, bind := randToken(32), randToken(32), randToken(32)
	if !a.putState(state, pending{provider: name, verifier: verifier, next: safeNext(c.Query("next")), bind: sum(bind), exp: time.Now().Add(stateTTL)}) {
		httpapi.Abort(c, http.StatusServiceUnavailable, "auth_unavailable", "error.authUnavailable")
		return
	}
	// Gắn state với trình duyệt đã bấm đăng nhập, để kẻ khác không đưa được link callback của họ cho nạn nhân.
	http.SetCookie(c.Writer, &http.Cookie{Name: bindName(state), Value: bind, Path: "/", MaxAge: int(stateTTL.Seconds()), HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode})
	ch := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"response_type": {"code"}, "client_id": {p.ClientID}, "redirect_uri": {a.redirectURI(name)},
		"scope": {scopes[name]}, "state": {state},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(ch[:])}, "code_challenge_method": {"S256"},
	}
	c.Header("Cache-Control", "no-store")
	c.Redirect(http.StatusFound, p.Auth+"?"+q.Encode())
}

func (a *Auth) finish(c *gin.Context, next, errCode string) {
	c.Header("Cache-Control", "no-store")
	dest := next
	if errCode != "" {
		u, _ := url.Parse(next)
		q := u.Query()
		q.Set("auth_error", errCode)
		u.RawQuery = q.Encode()
		dest = u.String()
	}
	c.Redirect(http.StatusFound, a.origin+dest)
}

func (a *Auth) callback(c *gin.Context) {
	name, p, ok := a.ready(c)
	if !ok {
		return
	}
	st, valid := a.takeState(c.Query("state"))
	bn := bindName(c.Query("state"))
	bind, _ := c.Cookie(bn)
	http.SetCookie(c.Writer, &http.Cookie{Name: bn, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode})
	if !valid || st.provider != name || !eq(sum(bind), st.bind) {
		httpapi.Abort(c, http.StatusBadRequest, "invalid_state", "error.invalidState")
		return
	}
	code := c.Query("code")
	if c.Query("error") != "" || code == "" { // người dùng hủy ở trang đồng ý
		a.finish(c, st.next, "cancelled")
		return
	}
	prof, subject, err := a.exchange(c, name, p, code, st.verifier)
	if err != nil {
		log.Printf("auth: %s sign-in failed: %v", name, err)
		a.finish(c, st.next, "failed")
		return
	}
	u, err := a.store.UpsertIdentity(c.Request.Context(), name, subject, prof)
	if err != nil {
		log.Print("auth: upsert identity failed")
		a.finish(c, st.next, "failed")
		return
	}
	tok, err := a.store.CreateSession(c.Request.Context(), u.ID, sessionTTL)
	if err != nil {
		log.Print("auth: create session failed")
		a.finish(c, st.next, "failed")
		return
	}
	http.SetCookie(c.Writer, a.sessionCookie(tok, int(sessionTTL.Seconds())))
	a.finish(c, st.next, "")
}

// Thông báo lỗi ở đây là chuỗi cố định: không đưa err của http.Client vào vì nó chứa URL.
func (a *Auth) postForm(c *gin.Context, u string, v url.Values) ([]byte, error) {
	req, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, u, strings.NewReader(v.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	return a.do(req)
}

func (a *Auth) do(req *http.Request) ([]byte, error) {
	resp, err := a.hc.Do(req)
	if err != nil {
		return nil, errors.New("provider unreachable")
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil, errors.New("provider rejected request")
	}
	return b, nil
}

// exchange đổi code lấy token rồi lấy hồ sơ. Trả hồ sơ và mã người dùng bất biến của nhà cung cấp.
func (a *Auth) exchange(c *gin.Context, name string, p Provider, code, verifier string) (store.Profile, string, error) {
	raw, err := a.postForm(c, p.Token, url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {a.redirectURI(name)},
		"client_id": {p.ClientID}, "client_secret": {p.ClientSecret}, "code_verifier": {verifier},
	})
	if err != nil {
		return store.Profile{}, "", err
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(raw, &tok) != nil || tok.AccessToken == "" { // GitHub trả lỗi với mã 200
		return store.Profile{}, "", errors.New("no access token")
	}
	req, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, p.UserInfo, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/json")
	if raw, err = a.do(req); err != nil {
		return store.Profile{}, "", err
	}
	var in struct {
		Sub           string      `json:"sub"` // Google
		ID            json.Number `json:"id"`  // GitHub
		Login         string      `json:"login"`
		Name          string      `json:"name"`
		Email         string      `json:"email"`
		EmailVerified *bool       `json:"email_verified"`
		Picture       string      `json:"picture"`
		AvatarURL     string      `json:"avatar_url"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return store.Profile{}, "", errors.New("bad profile")
	}
	subject := in.Sub
	if name == "github" {
		subject = in.ID.String()
	}
	if subject == "" {
		return store.Profile{}, "", errors.New("no subject")
	}
	prof := store.Profile{DisplayName: first(in.Name, in.Login, "User"), Email: in.Email, AvatarURL: first(in.Picture, in.AvatarURL)}
	if in.EmailVerified != nil && !*in.EmailVerified {
		prof.Email = ""
	}
	if !strings.HasPrefix(prof.AvatarURL, "https://") {
		prof.AvatarURL = ""
	}
	return prof, subject, nil
}

func first(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
