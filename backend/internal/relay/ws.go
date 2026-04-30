package relay

import (
	"encoding/binary"
	"io"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"
)

// maxMessageBytes caps inbound blob size to prevent runaway allocations.
// A Loro delta for a single task toggle is typically < 200 bytes.
// A full-sync snapshot for 10k tasks is unlikely to exceed 4 MB.
const maxMessageBytes = 4 << 20 // 4 MiB

// Handler returns an http.HandlerFunc that upgrades to WebSocket.
//
// Wire format (binary frame):
//   [4 bytes big-endian: client_id length][client_id UTF-8][N bytes: SyncMessage protobuf]
//
// The handler reads the client_id prefix, strips it, and forwards the raw
// protobuf blob to every other connected client.  It NEVER deserializes the
// payload — the Loro binary diff inside SyncMessage.payload is opaque to Go.
//
// This design means a schema change in the Rust CRDT layer requires zero
// changes to the relay.
func Handler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // TODO: restrict origins in prod
		})
		if err != nil {
			slog.Error("ws accept", "err", err)
			return
		}

		clientID := r.URL.Query().Get("client_id")
		if clientID == "" {
			conn.Close(websocket.StatusPolicyViolation, "client_id required")
			return
		}

		c := &Client{ID: clientID, Send: make(chan []byte, 128)}
		hub.Register(c)
		defer hub.Unregister(c)

		ctx := r.Context()

		// ── outbound pump ───────────────────────────────────────────────────
		go func() {
			for data := range c.Send {
				if err := conn.Write(ctx, websocket.MessageBinary, data); err != nil {
					slog.Warn("ws write", "client", clientID, "err", err)
					return
				}
			}
		}()

		// ── inbound loop ────────────────────────────────────────────────────
		for {
			msgType, r, err := conn.Reader(ctx)
			if err != nil {
				break
			}
			if msgType != websocket.MessageBinary {
				io.Copy(io.Discard, r) // discard stray text frames
				continue
			}

			data, err := io.ReadAll(io.LimitReader(r, maxMessageBytes))
			if err != nil {
				slog.Warn("ws read", "client", clientID, "err", err)
				break
			}

			if len(data) < 4 {
				slog.Warn("frame too short", "client", clientID, "len", len(data))
				continue
			}

			// Peek at the 4-byte length prefix to extract client_id for logging.
			// We do NOT deserialize the protobuf payload.
			idLen := binary.BigEndian.Uint32(data[:4])
			if int(idLen)+4 > len(data) {
				slog.Warn("malformed frame", "client", clientID)
				continue
			}
			senderID := string(data[4 : 4+idLen])

			slog.Info("relaying blob",
				"from",  senderID,
				"bytes", len(data),
			)

			hub.Broadcast(ctx, senderID, data)
		}
	}
}
