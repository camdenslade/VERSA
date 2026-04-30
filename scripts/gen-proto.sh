#!/usr/bin/env bash
# Regenerates Go + Swift protobuf bindings from proto/sync.proto
# Run from the repo root: ./scripts/gen-proto.sh
set -euo pipefail

echo "==> Generating protobuf bindings"
cd proto
buf generate
echo "==> Done"
