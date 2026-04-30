package relay

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/nats-io/nats.go"
)

// Client represents one connected device on this relay node.
type Client struct {
	ID   string
	Room string
	Send chan []byte
}

// Hub manages local clients and bridges to NATS for cross-node fan-out.
// Each relay node is stateless with respect to other nodes — NATS is the
// shared backplane.
type Hub struct {
	nc *nats.Conn

	mu      sync.RWMutex
	clients map[string]*Client // key: clientID
	subs    map[string]*nats.Subscription // key: room, one sub per room on this node
}

func NewHub(nc *nats.Conn) *Hub {
	return &Hub{
		nc:      nc,
		clients: make(map[string]*Client),
		subs:    make(map[string]*nats.Subscription),
	}
}

// Register adds a client and ensures this node is subscribed to its room.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c.ID] = c
	slog.Info("client connected", "id", c.ID, "room", c.Room, "total", len(h.clients))

	if h.nc == nil || c.Room == "" {
		return // local-only mode or empty room — rely on local broadcast
	}
	if _, ok := h.subs[c.Room]; !ok {
		room := c.Room
		sub, err := h.nc.Subscribe(roomSubject(room), func(msg *nats.Msg) {
			h.deliverToRoom(room, msg.Data)
		})
		if err != nil {
			slog.Error("nats subscribe failed", "room", room, "err", err)
			return
		}
		h.subs[room] = sub
	}
}

// Unregister removes a client and cleans up the room subscription if empty.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[c.ID]; !ok {
		return
	}
	delete(h.clients, c.ID)
	close(c.Send)
	slog.Info("client disconnected", "id", c.ID, "room", c.Room, "total", len(h.clients))

	// Unsubscribe from NATS if no local clients remain in this room.
	roomEmpty := true
	for _, cl := range h.clients {
		if cl.Room == c.Room {
			roomEmpty = false
			break
		}
	}
	if roomEmpty {
		if sub, ok := h.subs[c.Room]; ok {
			_ = sub.Unsubscribe()
			delete(h.subs, c.Room)
		}
	}
}

// Broadcast delivers data to all clients in the given room.
// room is passed directly from ws.go (derived from JWT claims), so it's always correct.
func (h *Hub) Broadcast(ctx context.Context, room string, data []byte) {
	if h.nc != nil && room != "" {
		if err := h.nc.Publish(roomSubject(room), data); err != nil {
			slog.Error("nats publish failed", "room", room, "err", err)
			h.deliverToRoom(room, data)
		}
		return
	}
	h.deliverToRoom(room, data)
}

// deliverToRoom fans out a NATS message to local clients in a room,
// skipping the original sender (identified by the 4-byte prefix in the frame).
func (h *Hub) deliverToRoom(room string, data []byte) {
	senderID := extractSenderID(data)

	h.mu.RLock()
	defer h.mu.RUnlock()

	for id, c := range h.clients {
		if c.Room != room || id == senderID {
			continue
		}
		select {
		case c.Send <- data:
		default:
			slog.Warn("client send buffer full, dropping update", "id", id)
		}
	}
}

func roomSubject(room string) string {
	return fmt.Sprintf("versa.rooms.%s", room)
}

// extractSenderID reads the client_id string from the 4-byte-prefixed wire frame.
// Returns empty string if the frame is malformed — caller skips dedup in that case.
func extractSenderID(data []byte) string {
	if len(data) < 4 {
		return ""
	}
	idLen := int(uint32(data[0])<<24 | uint32(data[1])<<16 | uint32(data[2])<<8 | uint32(data[3]))
	if 4+idLen > len(data) {
		return ""
	}
	return string(data[4 : 4+idLen])
}
