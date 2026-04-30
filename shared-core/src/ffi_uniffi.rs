// UniFFI surface — Swift / Kotlin bindings.
// This file only compiles when --features uniffi is set (iOS / macOS builds).
//
// ── Ownership model ──────────────────────────────────────────────────────────
// UniFFI wraps every `#[uniffi::Object]` in Arc<T>.  Swift holds a strong
// reference via its generated wrapper class.  When the Swift object is
// deinit'd, the Arc refcount drops.  You never call free() manually.
//
// ⚠ PITFALL: Do NOT store a raw pointer to Rust memory and pass it back to
// Swift as an UnsafePointer — UniFFI's Arc handles lifetime correctly; raw
// pointers do not.  Stick to the generated API.

use std::sync::Arc;
use crate::engine::CrdtEngine;
use crate::types::{Task, VersaError};

// Re-export Task with UniFFI annotations so the generated Swift struct matches.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTask {
    pub id:            String,
    pub content:       String,
    pub is_completed:  bool,
    pub last_modified: i64,
}

impl From<Task> for FfiTask {
    fn from(t: Task) -> Self {
        Self {
            id:            t.id,
            content:       t.content,
            is_completed:  t.is_completed,
            last_modified: t.last_modified,
        }
    }
}

impl From<FfiTask> for Task {
    fn from(t: FfiTask) -> Self {
        Self {
            id:            t.id,
            content:       t.content,
            is_completed:  t.is_completed,
            last_modified: t.last_modified,
        }
    }
}

#[derive(Debug, uniffi::Error, thiserror::Error)]
pub enum FfiError {
    #[error("{msg}")]
    Core { msg: String },
}

impl From<VersaError> for FfiError {
    fn from(e: VersaError) -> Self {
        FfiError::Core { msg: e.to_string() }
    }
}

// ── The exported object ───────────────────────────────────────────────────────

#[derive(uniffi::Object)]
pub struct VersaCoreEngine(Arc<CrdtEngine>);

#[uniffi::export]
impl VersaCoreEngine {
    #[uniffi::constructor]
    pub fn new(client_id: String) -> Arc<Self> {
        Arc::new(Self(Arc::new(CrdtEngine::new(client_id))))
    }

    /// Apply a task mutation. Returns the binary diff to forward to the relay.
    pub fn apply_task(&self, task: FfiTask) -> Result<Vec<u8>, FfiError> {
        self.0.apply_task(task.into()).map_err(Into::into)
    }

    /// Merge a binary diff received from the relay.
    pub fn merge_update(&self, bytes: Vec<u8>) -> Result<(), FfiError> {
        self.0.merge_update(bytes).map_err(Into::into)
    }

    /// Full snapshot for SQLite persistence.
    pub fn snapshot(&self) -> Vec<u8> {
        self.0.snapshot()
    }

    /// Materialised task list for initial UI render.
    pub fn get_tasks(&self) -> Vec<FfiTask> {
        self.0.get_tasks().into_iter().map(Into::into).collect()
    }
}

// ── Bridge validation ─────────────────────────────────────────────────────────
#[uniffi::export]
pub fn reverse_string(input: String) -> String {
    input.chars().rev().collect()
}
