fn main() {
    // Only generate UniFFI scaffolding when the "uniffi" feature is active.
    // The WASM build never hits this path.
    #[cfg(feature = "uniffi")]
    uniffi::generate_scaffolding("src/versa_core.udl").unwrap();
}
