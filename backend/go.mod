module github.com/camslade/versa/backend

go 1.25.0

require (
	github.com/coder/websocket v1.8.12
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/nats-io/nats.go v1.51.0
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/crypto v0.49.0 // indirect
	golang.org/x/sys v0.42.0 // indirect
	modernc.org/libc v1.72.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
	modernc.org/sqlite v1.50.0 // indirect
)

// google.golang.org/protobuf is intentionally absent here.
// It will be added automatically by `go mod tidy` after running
// `./scripts/gen-proto.sh`, which generates the Go source files
// in backend/gen/ that actually import it.
