package httpapi

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

const ShutdownTimeout = 10 * time.Second

// Serve serves h on ln until ctx is done, then waits up to timeout for in-flight requests.
func Serve(ctx context.Context, ln net.Listener, h http.Handler, timeout time.Duration) error {
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
