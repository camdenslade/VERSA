package relay

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/camslade/versa/backend/internal/auth"
	"github.com/coder/websocket"
)

const maxMessageBytes = 4 << 20 // 4 MiB

// reAuthWarningBefore is how long before expiry we warn the client to refresh.
const reAuthWarningBefore = 2 * time.Minute

// controlMsg is a JSON envelope for relay→client control messages.
type controlMsg struct {
	Type    string `json:"type"`
	Payload any    `json:"payload,omitempty"`
}

func Handler(hub *Hub, validator *auth.Validator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			// Fallback: allow bare client_id for local dev (no validator configured)
			if validator == nil {
				handleUnauthenticated(w, r, hub)
				return
			}
			http.Error(w, "token required", http.StatusUnauthorized)
			return
		}

		claims, err := validator.Validate(r.Context(), tokenStr)
		if err != nil {
			slog.Warn("jwt validation failed", "err", err)
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		userID := claims.Subject
		deviceID := claims.DeviceID
		if deviceID == "" {
			deviceID = userID // fallback if no device_id in token
		}
		room := claims.AppID
		if room == "" || room == "00000000-0000-0000-0000-000000000000" {
			room = userID
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			slog.Error("ws accept", "err", err)
			return
		}

		c := &Client{ID: deviceID, Room: room, Send: make(chan []byte, 128)}
		buffered := hub.Register(c)
		defer hub.Unregister(c)

		// Replay buffered frames so the client catches up before live updates.
		for _, frame := range buffered {
			select {
			case c.Send <- frame:
			default:
				slog.Warn("catch-up buffer full, dropping frame", "client", deviceID)
			}
		}
		if len(buffered) > 0 {
			slog.Info("replayed buffered frames", "client", deviceID, "count", len(buffered))
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		// Warn the client reAuthWarningBefore the token expires so it can
		// refresh without disconnecting. After expiry, close the connection.
		ttl := auth.TimeUntilExpiry(claims)
		warnAfter := ttl - reAuthWarningBefore
		if warnAfter < 0 {
			warnAfter = 0
		}

		// reauthCh signals the expiry goroutine to reset its timer when the
		// client successfully reauthenticates.
		reauthCh := make(chan time.Duration, 1)

		go func() {
			warn := warnAfter
			grace := reAuthWarningBefore
			for {
				select {
				case <-ctx.Done():
					return
				case ttl := <-reauthCh:
					// Client reauthenticated -- reset timers based on new TTL.
					warn = ttl - reAuthWarningBefore
					if warn < 0 {
						warn = 0
					}
					grace = reAuthWarningBefore
					continue
				case <-time.After(warn):
				}
				msg, _ := json.Marshal(controlMsg{Type: "token_expiring_soon"})
				_ = conn.Write(ctx, websocket.MessageText, msg)
				select {
				case <-ctx.Done():
					return
				case ttl := <-reauthCh:
					warn = ttl - reAuthWarningBefore
					if warn < 0 {
						warn = 0
					}
					grace = reAuthWarningBefore
					_ = grace
					continue
				case <-time.After(grace):
					slog.Info("token expired, closing connection", "client", deviceID)
					conn.Close(websocket.StatusPolicyViolation, "token expired")
					cancel()
					return
				}
			}
		}()

		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case data, ok := <-c.Send:
					if !ok {
						return
					}
					if err := conn.Write(ctx, websocket.MessageBinary, data); err != nil {
						slog.Warn("ws write", "client", deviceID, "err", err)
						return
					}
				}
			}
		}()

		for {
			msgType, r, err := conn.Reader(ctx)
			if err != nil {
				break
			}

			// Control messages (text frames) — handle re-auth
			if msgType == websocket.MessageText {
				raw, _ := io.ReadAll(io.LimitReader(r, 4096))
				var ctrl struct {
					Type  string `json:"type"`
					Token string `json:"token"`
				}
				if json.Unmarshal(raw, &ctrl) == nil && ctrl.Type == "ping" {
					continue
				}
				if json.Unmarshal(raw, &ctrl) == nil && ctrl.Type == "reauth" {
					newClaims, err := validator.Validate(ctx, ctrl.Token)
					if err != nil {
						slog.Warn("reauth failed", "client", deviceID, "err", err)
						conn.Close(websocket.StatusPolicyViolation, "reauth failed")
						return
					}
					slog.Info("reauth accepted", "client", deviceID, "new_exp", newClaims.ExpiresAt)
					select {
					case reauthCh <- auth.TimeUntilExpiry(newClaims):
					default:
					}
					ack, _ := json.Marshal(controlMsg{Type: "reauth_ok"})
					_ = conn.Write(ctx, websocket.MessageText, ack)
				}
				continue
			}

			if msgType != websocket.MessageBinary {
				io.Copy(io.Discard, r)
				continue
			}

			data, err := io.ReadAll(io.LimitReader(r, maxMessageBytes))
			if err != nil {
				slog.Warn("ws read", "client", deviceID, "err", err)
				break
			}

			if len(data) < 4 {
				slog.Warn("frame too short", "client", deviceID, "len", len(data))
				continue
			}

			idLen := binary.BigEndian.Uint32(data[:4])
			if int(idLen)+4 > len(data) {
				slog.Warn("malformed frame", "client", deviceID)
				continue
			}
			senderID := string(data[4 : 4+idLen])

			slog.Info("relaying blob",
				"from", senderID,
				"room", room,
				"bytes", len(data),
			)

			hub.Broadcast(ctx, room, data)
		}
	}
}

// handleUnauthenticated handles connections without a token (local dev only).
func handleUnauthenticated(w http.ResponseWriter, r *http.Request, hub *Hub) {
	deviceID := r.URL.Query().Get("client_id")
	if deviceID == "" {
		http.Error(w, "client_id required", http.StatusBadRequest)
		return
	}
	room := r.URL.Query().Get("room")
	if room == "" {
		room = "default"
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		slog.Error("ws accept", "err", err)
		return
	}

	c := &Client{ID: deviceID, Room: room, Send: make(chan []byte, 128)}
	buffered := hub.Register(c)
	defer hub.Unregister(c)

	for _, frame := range buffered {
		select {
		case c.Send <- frame:
		default:
		}
	}

	ctx := r.Context()

	go func() {
		for data := range c.Send {
			if err := conn.Write(ctx, websocket.MessageBinary, data); err != nil {
				return
			}
		}
	}()

	for {
		msgType, r, err := conn.Reader(ctx)
		if err != nil {
			break
		}
		if msgType != websocket.MessageBinary {
			io.Copy(io.Discard, r)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(r, maxMessageBytes))
		if err != nil {
			break
		}
		if len(data) < 4 {
			continue
		}
		idLen := binary.BigEndian.Uint32(data[:4])
		if int(idLen)+4 > len(data) {
			continue
		}
		senderID := string(data[4 : 4+idLen])
		slog.Info("relaying blob", "from", senderID, "room", room, "bytes", len(data))
		hub.Broadcast(ctx, room, data)
	}
}
