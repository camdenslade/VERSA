#!/usr/bin/env bash
# Builds the Rust shared-core as an XCFramework for use in the iOS app.
# Run from the repo root: ./scripts/build-rust-xcframework.sh
set -euo pipefail

source "$HOME/.cargo/env"

CRATE_DIR="shared-core"
CRATE_NAME="versa_core"
OUT_DIR="ios-app/Frameworks"
RUST_TARGET_DIR="$CRATE_DIR/target"

echo "==> Adding Apple targets"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

echo "==> Building for device (arm64)"
cargo build --manifest-path "$CRATE_DIR/Cargo.toml" \
    --release --features uniffi --target aarch64-apple-ios

echo "==> Building for simulator (arm64 + x86_64)"
cargo build --manifest-path "$CRATE_DIR/Cargo.toml" \
    --release --features uniffi --target aarch64-apple-ios-sim

cargo build --manifest-path "$CRATE_DIR/Cargo.toml" \
    --release --features uniffi --target x86_64-apple-ios

echo "==> Generating Swift bindings via UniFFI"
# Use --library mode: reads checksums directly from the compiled .a so they
# always agree with the binary.  This avoids the UDL-vs-proc-macro drift that
# causes the "checksum mismatch" fatal error at app launch.
# Must cd into the crate dir because --library mode runs `cargo metadata` there.
(cd "$CRATE_DIR" && cargo run \
    --features uniffi --bin uniffi-bindgen -- \
    generate --library "target/aarch64-apple-ios/release/lib${CRATE_NAME}.a" \
    --language swift \
    --out-dir "../ios-app/Sources/Generated")

echo "==> Lipo simulator slices"
mkdir -p "$RUST_TARGET_DIR/lipo-sim"
lipo -create \
    "$RUST_TARGET_DIR/aarch64-apple-ios-sim/release/lib${CRATE_NAME}.a" \
    "$RUST_TARGET_DIR/x86_64-apple-ios/release/lib${CRATE_NAME}.a" \
    -output "$RUST_TARGET_DIR/lipo-sim/lib${CRATE_NAME}.a"

echo "==> Packaging XCFramework"
mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR/VersaCore.xcframework"
xcodebuild -create-xcframework \
    -library "$RUST_TARGET_DIR/aarch64-apple-ios/release/lib${CRATE_NAME}.a" \
    -headers "ios-app/Sources/Generated" \
    -library "$RUST_TARGET_DIR/lipo-sim/lib${CRATE_NAME}.a" \
    -headers "ios-app/Sources/Generated" \
    -output "$OUT_DIR/VersaCore.xcframework"

echo "==> Done: $OUT_DIR/VersaCore.xcframework"
