package relay

import (
	"database/sql"
	"log/slog"

	_ "modernc.org/sqlite"
)

// Store persists CRDT diff frames to SQLite so the relay survives restarts.
// Each room gets its own logical partition in the room_frames table.
// The table is a rolling window -- frames beyond bufferMaxFrames per room
// are pruned on write to match the in-memory ring buffer behaviour.
type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_journal=WAL&_synchronous=NORMAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS room_frames (
			id    INTEGER PRIMARY KEY AUTOINCREMENT,
			room  TEXT    NOT NULL,
			frame BLOB    NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_room_frames_room ON room_frames(room);
	`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() { _ = s.db.Close() }

// AppendFrame writes a frame and prunes the oldest rows beyond bufferMaxFrames.
func (s *Store) AppendFrame(room string, frame []byte) {
	_, err := s.db.Exec(`INSERT INTO room_frames (room, frame) VALUES (?, ?)`, room, frame)
	if err != nil {
		slog.Warn("store: insert frame failed", "room", room, "err", err)
		return
	}
	// Prune oldest rows so the table doesn't grow unbounded.
	_, err = s.db.Exec(`
		DELETE FROM room_frames
		WHERE room = ? AND id NOT IN (
			SELECT id FROM room_frames WHERE room = ? ORDER BY id DESC LIMIT ?
		)`, room, room, bufferMaxFrames)
	if err != nil {
		slog.Warn("store: prune failed", "room", room, "err", err)
	}
}

// LoadFrames returns all persisted frames for a room in insertion order.
func (s *Store) LoadFrames(room string) [][]byte {
	rows, err := s.db.Query(
		`SELECT frame FROM room_frames WHERE room = ? ORDER BY id ASC`, room)
	if err != nil {
		slog.Warn("store: load frames failed", "room", room, "err", err)
		return nil
	}
	defer rows.Close()

	var frames [][]byte
	for rows.Next() {
		var f []byte
		if err := rows.Scan(&f); err == nil {
			frames = append(frames, f)
		}
	}
	return frames
}

// Rooms returns all room names that have persisted frames.
func (s *Store) Rooms() []string {
	rows, err := s.db.Query(`SELECT DISTINCT room FROM room_frames`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var rooms []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err == nil {
			rooms = append(rooms, r)
		}
	}
	return rooms
}
