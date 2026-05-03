# VERSA

A local-first real-time sync framework built on CRDTs. Apps stay fully functional offline, sync instantly when connected, and resolve conflicts automatically -- no merge logic required.

**[Live benchmark](https://versa.cslade.space/bench)** -- runs in your browser against a real relay.

---

## How it works

VERSA is built around a single Rust CRDT engine that compiles to both WASM (web) and a native library (iOS via UniFFI). Every edit produces a binary delta. Deltas are forwarded through a stateless Go relay and merged on every device. There is no server-side state, no authoritative copy, and no last-write-wins.

```
Device A                  Go relay               Device B
  |                          |                      |
  |- apply_task() ---------->|                      |
  |  (CRDT delta, ~40-120B)  |- fan-out ----------->|
  |                          |                      |- merge_update()
  |                          |                      |  (converges automatically)
```

Conflicts are resolved by the CRDT -- two devices editing the same field concurrently both have their edits preserved. No application code required.

---

## Benchmark

VERSA latency is measured end-to-end against the live relay at `versa.cslade.space` -- delta sent, received by a second connected client -- over a 50-round run with a 512B payload. GraphQL and REST numbers are modeled from the same measured RTT using architectural constants (GraphQL adds an 8ms server resolver round-trip and always broadcasts the full object; REST uses average staleness at a 500ms poll interval).

| | VERSA | GraphQL subscriptions | REST polling |
|---|---|---|---|
| **Median latency** | 44.9 ms | 53.3 ms | 294.9 ms |
| **p99 latency** | 49.3 ms | 57.7 ms | 299.3 ms |
| **Bytes per update** | 552 B | 1.1 KB | 932 B |
| **Bandwidth (50 rounds)** | 25.8 KB | 66.5 KB | 60.2 KB |
| **Conflict resolution** | Automatic | Last-write-wins (data loss) | 409 + retry loop |

Run it yourself (includes the modeling methodology): [versa.cslade.space/bench](https://versa.cslade.space/bench)

---

## Stack

| Layer | Technology |
|---|---|
| CRDT engine | Rust + [Loro](https://loro.dev) |
| Web binding | `wasm-bindgen`, compiled to WASM |
| iOS binding | UniFFI, compiled to XCFramework |
| Relay | Go, WebSocket, optional NATS for multi-node |
| Persistence | SQLite WAL (relay), Keychain (iOS), localStorage (web) |
| Auth | [Kimbu](https://kimbu.cslade.space) -- self-hosted OIDC, RS256 JWTs |

---

## Project structure

```
shared-core/     Rust CRDT engine (compiles to WASM + native)
  src/
    engine.rs     Core CrdtEngine -- apply, merge, snapshot
    types.rs      Task, List structs
    ffi_wasm.rs   wasm-bindgen bindings
    ffi_uniffi.rs UniFFI bindings for iOS

backend/         Go relay
  internal/relay/
    hub.go        Client registration, NATS fan-out
    ws.go         WebSocket handler, JWT auth, re-auth flow
    buffer.go     In-memory ring buffer for catch-up on reconnect
    store.go      SQLite persistence across relay restarts
    bench.go      /bench endpoint

ios-app/         Swift/SwiftUI
  Sources/
    Models/TaskEngine.swift     @Observable engine, CRDT bridge
    Bridge/RelayTransport.swift WebSocket + offline queue
    Views/ContentView.swift     UI

web-app/         React + TypeScript
  src/
    hooks/useVersaStore.ts  State management, sync, offline queue
    wasm/versaEngine.ts     WASM lifecycle
```

---

## Running locally

**Relay**

```bash
cd backend
go run ./cmd/server
# relay starts on :8080
# optional: RELAY_DB_PATH, NATS_URL, KIMBU_JWKS_URL, JWT_SECRET
```

**Web app**

```bash
cd shared-core
wasm-pack build --out-dir ../web-app/src/wasm/pkg

cd ../web-app
npm install
npm run dev
```

**iOS**

Build the XCFramework from `shared-core`, then open `ios-app` in Xcode. Set `RELAY_HOST` and `RELAY_PORT` in the scheme environment variables.

---

## License

MIT -- see [LICENSE](LICENSE).
