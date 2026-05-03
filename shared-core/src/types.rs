// Shared data types — no FFI annotations here.
// Both the UniFFI and WASM layers derive from these.

#[derive(Debug, Clone)]
pub struct Task {
    pub id:            String,
    pub list_id:       String, // which list this task belongs to; "default" for legacy tasks
    pub content:       String,
    pub is_completed:  bool,
    pub position:      i64, // epoch ms at creation time — monotonically increasing, stable sort key
    pub last_modified: i64, // epoch ms
}

#[derive(Debug, Clone)]
pub struct List {
    pub id:            String,
    pub name:          String,
    pub last_modified: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum VersaError {
    #[error("Merge failure: {0}")]
    MergeFailure(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}
