package httpapi

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// MaxBodyBytes is the default request body limit.
const MaxBodyBytes = 1 << 20

// NewRouter builds the engine. Gin runs in release mode unless GIN_MODE is set.
func NewRouter() *gin.Engine { return NewRouterWithLog(os.Stderr) }

// NewRouterWithLog is NewRouter with the request log sent to out.
func NewRouterWithLog(out io.Writer) *gin.Engine {
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	_ = r.SetTrustedProxies(nil) // no proxy header is trusted until config says so
	r.HandleMethodNotAllowed = true
	// Redirects would answer with a non-JSON body and echo the raw path.
	r.RedirectTrailingSlash, r.RedirectFixedPath = false, false
	// Order matters: logger outermost so it sees the 500 written by recovery.
	r.Use(requestLog(log.New(out, "", log.LstdFlags)), recovery(out), limitBody(MaxBodyBytes))
	r.NoRoute(func(c *gin.Context) { Abort(c, http.StatusNotFound, "not_found", "error.notFound") })
	r.NoMethod(func(c *gin.Context) {
		Abort(c, http.StatusMethodNotAllowed, "method_not_allowed", "error.methodNotAllowed")
	})
	// Must not touch external services: the keep-alive ping calls it.
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}

// Abort writes the shared error format {"error":{"code","messageKey"}}.
func Abort(c *gin.Context, status int, code, messageKey string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "messageKey": messageKey}})
}

var knownMethods = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true}

// requestLog logs method, matched route pattern, status and duration only.
// The raw path, query, headers and body can hold user SQL, so they never get logged.
func requestLog(l *log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		method := c.Request.Method
		if !knownMethods[method] {
			method = "OTHER" // the method token is client-controlled
		}
		l.Printf("%s %s %d %s", method, route, c.Writer.Status(), time.Since(start))
	}
}

// recovery turns a panic into a 500 without logging the request or the panic value,
// which may carry user SQL.
func recovery(out io.Writer) gin.HandlerFunc {
	l := log.New(out, "", log.LstdFlags)
	return func(c *gin.Context) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				l.Printf("panic recovered (%T)", v)
				Abort(c, http.StatusInternalServerError, "internal", "error.internal")
			}
		}()
		c.Next()
	}
}

// limitBody rejects bodies over max. Handlers that read the body must pass a read
// error to c.Error; a *http.MaxBytesError then becomes 413 if nothing was written.
func limitBody(max int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > max {
			Abort(c, http.StatusRequestEntityTooLarge, "payload_too_large", "error.payloadTooLarge")
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max)
		c.Next()
		var mbe *http.MaxBytesError
		for _, e := range c.Errors {
			if errors.As(e.Err, &mbe) && !c.Writer.Written() {
				Abort(c, http.StatusRequestEntityTooLarge, "payload_too_large", "error.payloadTooLarge")
				return
			}
		}
	}
}
