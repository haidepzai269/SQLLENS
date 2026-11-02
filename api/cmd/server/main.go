package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
)

func port() (string, error) {
	p := os.Getenv("PORT")
	if p == "" {
		return "8080", nil
	}
	if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("invalid PORT %q: want an integer 1-65535", p)
	}
	return p, nil
}

func main() {
	p, err := port()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ln, err := net.Listen("tcp", ":"+p)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := httpapi.Serve(ctx, ln, httpapi.NewRouter(), httpapi.ShutdownTimeout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
