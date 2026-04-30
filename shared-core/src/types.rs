// Shared data types — no FFI annotations here.
// Both the UniFFI and WASM layers derive from these.

#[derive(Debug, Clone)]
pub struct Task {
    pub id:            String,
    pub content:       String,
    pub is_completed:  bool,
    pub last_modified: i64, // epoch ms
}

#[derive(Debug, thiserror::Error)]
pub enum VersaError {
    #[error("Merge failure: {0}")]
    MergeFailure(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}
