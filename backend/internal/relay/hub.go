// Package relay implements the WebSocket sync relay.
// It is intentionally stateless: it receives a SyncUpdate from one client
// and fans it out to every other connected client.  The Postgres store is
// append-only — it keeps the "golden record" for clients that reconnect.
package relay

import (
	"context"
	"log/slog"
	"sync"
)

// Client represents one connected device.
type Client struct {
	ID   string
	Send chan []byte // raw protobuf bytes
}

// Hub fan-outs updates to all connected clients except the sender.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]*Client
}

func NewHub() *Hub {
	return &Hub{clients: make(map[string]*Client)}
}

// Register adds a client to the hub.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c.ID] = c
	slog.Info("client connected", "id", c.ID, "total", len(h.clients))
}

// Unregister removes a client and closes its send channel.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c.ID]; ok {
		delete(h.clients, c.ID)
		close(c.Send)
		slog.Info("client disconnected", "id", c.ID, "total", len(h.clients))
	}
}

// Broadcast sends raw bytes to every client except the originator.
func (h *Hub) Broadcast(ctx context.Context, senderID string, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for id, c := range h.clients {
		if id == senderID {
			continue
		}
		select {
		case c.Send <- data:
		default:
			slog.Warn("client send buffer full, dropping update", "id", id)
		}
	}
}
