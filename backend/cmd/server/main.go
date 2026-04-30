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

	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = nats.DefaultURL // nats://127.0.0.1:4222
	}

	nc, err := nats.Connect(natsURL,
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

	hub := relay.NewHub(nc)

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
