// versa-core — single Rust library, two FFI surfaces:
//
//   --features uniffi  →  native .a / .dylib  (iOS via UniFFI)
//   --features wasm    →  .wasm               (Web via wasm-bindgen)
//
// The core state logic lives in `engine` and `types` — neither surface
// module knows about the other.

mod engine;
mod types;

#[cfg(feature = "uniffi")]
mod ffi_uniffi;

#[cfg(feature = "wasm")]
mod ffi_wasm;

// UniFFI macro must live at the crate root.
#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();

// Re-export the public error type so both FFI layers can reference it.
pub use types::VersaError;
