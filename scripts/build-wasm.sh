#!/usr/bin/env bash
# Builds the Rust shared-core as a WASM module for the web app.
# Run from the repo root: ./scripts/build-wasm.sh
#
# Prerequisites:
#   cargo install wasm-pack
#   rustup target add wasm32-unknown-unknown
set -euo pipefail

source "$HOME/.cargo/env"

echo "==> Building WASM package"
# --out-dir must be a wasm-pack flag (before the crate path), not a cargo flag.
# wasm-pack resolves --out-dir relative to the crate directory, so we use an
# absolute path to land the output in web-app/src/wasm/pkg from the repo root.
wasm-pack build \
    --out-dir "$(pwd)/web-app/src/wasm/pkg" \
    --target web \
    shared-core \
    -- --features wasm

echo "==> Done: web-app/src/wasm/pkg/"
