module github.com/camslade/versa/backend

go 1.23

require github.com/coder/websocket v1.8.12

// google.golang.org/protobuf is intentionally absent here.
// It will be added automatically by `go mod tidy` after running
// `./scripts/gen-proto.sh`, which generates the Go source files
// in backend/gen/ that actually import it.
