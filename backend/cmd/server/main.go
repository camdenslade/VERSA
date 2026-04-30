package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/camslade/versa/backend/internal/relay"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	hub := relay.NewHub()

	mux := http.NewServeMux()
	mux.HandleFunc("/sync", relay.Handler(hub))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Listen on 0.0.0.0 explicitly so both IPv4 (127.0.0.1) and IPv6 (::1)
	// clients can connect — the iOS simulator uses IPv4, the browser may use IPv6.
	addr := "0.0.0.0:" + port
	slog.Info("versa relay starting", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}
