package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/camslade/versa/backend/internal/auth"
	"github.com/camslade/versa/backend/internal/relay"
	"github.com/nats-io/nats.go"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// NATS is optional — omit NATS_URL to run single-node without it.
	var nc *nats.Conn
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		var err error
		nc, err = nats.Connect(natsURL,
			nats.RetryOnFailedConnect(true),
			nats.MaxReconnects(-1),
			nats.ReconnectWait(2*time.Second),
			nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
				slog.Warn("nats disconnected", "err", err)
			}),
			nats.ReconnectHandler(func(_ *nats.Conn) {
				slog.Info("nats reconnected")
			}),
		)
		if err != nil {
			slog.Error("nats connect failed", "url", natsURL, "err", err)
			os.Exit(1)
		}
		defer nc.Drain()
		slog.Info("nats connected", "url", natsURL)
	} else {
		slog.Info("nats disabled, running single-node")
	}

	dbPath := os.Getenv("RELAY_DB_PATH")
	if dbPath == "" {
		dbPath = "/opt/versa/relay.db"
	}
	var store *relay.Store
	if s, err := relay.OpenStore(dbPath); err != nil {
		slog.Warn("relay store unavailable, running without persistence", "err", err)
	} else {
		store = s
		defer store.Close()
		slog.Info("relay store opened", "path", dbPath)
	}

	hub := relay.NewHub(nc, store)

	jwksURL   := os.Getenv("KIMBU_JWKS_URL")
	jwtSecret := os.Getenv("JWT_SECRET")
	var validator *auth.Validator
	if jwksURL != "" || jwtSecret != "" {
		validator = auth.NewValidator(jwksURL, jwtSecret)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/sync", relay.Handler(hub, validator))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	addr := "0.0.0.0:" + port
	slog.Info("versa relay starting", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}
