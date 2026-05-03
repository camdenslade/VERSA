package relay

import "sync"

const (
	bufferMaxFrames = 64
	bufferMaxBytes  = 512 * 1024
)

// RoomBuffer is a bounded ring buffer of recent CRDT diff frames for one room.
// On reconnect, new clients receive buffered frames so they converge without
// needing a live peer to send a full snapshot.
type RoomBuffer struct {
	mu     sync.Mutex
	frames [][]byte
	total  int    // bytes currently held
	room   string
	store  *Store
}

func (b *RoomBuffer) Push(frame []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.frames = append(b.frames, frame)
	b.total += len(frame)

	// Evict oldest frames until within both limits.
	for (len(b.frames) > bufferMaxFrames || b.total > bufferMaxBytes) && len(b.frames) > 0 {
		b.total -= len(b.frames[0])
		b.frames = b.frames[1:]
	}

	if b.store != nil {
		b.store.AppendFrame(b.room, frame)
	}
}

// Snapshot returns a copy of all buffered frames in order.
func (b *RoomBuffer) Snapshot() [][]byte {
	b.mu.Lock()
	defer b.mu.Unlock()

	out := make([][]byte, len(b.frames))
	copy(out, b.frames)
	return out
}
