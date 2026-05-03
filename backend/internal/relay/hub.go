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
	nc    *nats.Conn
	store *Store

	mu      sync.RWMutex
	clients map[string]*Client
	subs    map[string]*nats.Subscription
	buffers map[string]*RoomBuffer
}

func NewHub(nc *nats.Conn, store *Store) *Hub {
	h := &Hub{
		nc:      nc,
		store:   store,
		clients: make(map[string]*Client),
		subs:    make(map[string]*nats.Subscription),
		buffers: make(map[string]*RoomBuffer),
	}
	if store != nil {
		h.restoreFromStore()
	}
	return h
}

// restoreFromStore repopulates in-memory buffers from persisted frames so
// clients that connect after a relay restart can still catch up.
func (h *Hub) restoreFromStore() {
	for _, room := range h.store.Rooms() {
		frames := h.store.LoadFrames(room)
		if len(frames) == 0 {
			continue
		}
		buf := &RoomBuffer{room: room, store: h.store}
		for _, f := range frames {
			buf.frames = append(buf.frames, f)
			buf.total += len(f)
		}
		// Trim restored frames to stay within byte limit.
		for buf.total > bufferMaxBytes && len(buf.frames) > 0 {
			buf.total -= len(buf.frames[0])
			buf.frames = buf.frames[1:]
		}
		h.buffers[room] = buf
		slog.Info("restored room from store", "room", room, "frames", len(frames))
	}
}

// Register adds a client, subscribes to its room if needed, and returns any
// buffered frames so the caller can replay them to the new client for catch-up.
func (h *Hub) Register(c *Client) [][]byte {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c.ID] = c
	slog.Info("client connected", "id", c.ID, "room", c.Room, "total", len(h.clients))

	// Collect buffered frames before adding NATS subscription.
	var buffered [][]byte
	if buf, ok := h.buffers[c.Room]; ok {
		buffered = buf.Snapshot()
	}

	if h.nc != nil && c.Room != "" {
		if _, ok := h.subs[c.Room]; !ok {
			room := c.Room
			sub, err := h.nc.Subscribe(roomSubject(room), func(msg *nats.Msg) {
				h.deliverToRoom(room, msg.Data)
			})
			if err != nil {
				slog.Error("nats subscribe failed", "room", room, "err", err)
			} else {
				h.subs[room] = sub
			}
		}
	}

	return buffered
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

// Broadcast delivers data to all clients in the given room and buffers the frame
// for late-joining clients.
func (h *Hub) Broadcast(ctx context.Context, room string, data []byte) {
	h.bufferFrame(room, data)

	if h.nc != nil && room != "" {
		if err := h.nc.Publish(roomSubject(room), data); err != nil {
			slog.Error("nats publish failed", "room", room, "err", err)
			h.deliverToRoom(room, data)
		}
		return
	}
	h.deliverToRoom(room, data)
}

func (h *Hub) bufferFrame(room string, data []byte) {
	h.mu.Lock()
	buf, ok := h.buffers[room]
	if !ok {
		buf = &RoomBuffer{room: room, store: h.store}
		h.buffers[room] = buf
	}
	h.mu.Unlock()
	buf.Push(data)
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
