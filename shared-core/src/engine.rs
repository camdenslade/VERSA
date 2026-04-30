use std::sync::Mutex;
use loro::{ExportMode, LoroDoc, LoroValue};
use crate::types::{Task, VersaError};

pub struct CrdtEngine {
    doc:       Mutex<LoroDoc>,
    client_id: String,
}

impl CrdtEngine {
    pub fn new(client_id: String) -> Self {
        Self {
            doc:       Mutex::new(LoroDoc::new()),
            client_id,
        }
    }

    /// Apply a local task mutation.
    /// Returns a binary **delta** (ops since the last export) — not a snapshot.
    ///
    /// ⚠ WASM: copy the returned Vec<u8> into a JS Uint8Array immediately;
    ///   don't hold a view across an `await`.
    /// ⚠ UniFFI: this Vec<u8> is copied to Swift Data on the way out.
    ///   Call from a background Task{} to avoid blocking the main actor.
    pub fn apply_task(&self, task: Task) -> Result<Vec<u8>, VersaError> {
        let doc = self.doc.lock().unwrap();

        // Capture the current version vector BEFORE the mutation so the export
        // covers only the ops this call produces.
        let before_vv = doc.oplog_vv();

        let tasks_map = doc.get_map("tasks");
        let entry = tasks_map
            .insert_container(&task.id, loro::LoroMap::new())
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

        entry.insert("content",      task.content.as_str())
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("is_completed", task.is_completed)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("last_modified", task.last_modified)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

        // Export only the ops added after `before_vv`.
        doc.export(ExportMode::updates(&before_vv))
           .map_err(|e| VersaError::Serialization(e.to_string()))
    }

    pub fn delete_task(&self, id: String) -> Result<Vec<u8>, VersaError> {
        let doc = self.doc.lock().unwrap();
        let before_vv = doc.oplog_vv();
        let tasks_map = doc.get_map("tasks");
        tasks_map.delete(&id)
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        doc.export(ExportMode::updates(&before_vv))
           .map_err(|e| VersaError::Serialization(e.to_string()))
    }

    /// Merge a binary diff received from the Go relay.
    pub fn merge_update(&self, bytes: Vec<u8>) -> Result<(), VersaError> {
        let doc = self.doc.lock().unwrap();
        doc.import(&bytes)
            .map(|_| ())   // ImportStatus → ()
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        doc.checkout_to_latest();
        Ok(())
    }

    /// Full snapshot for SQLite / IndexedDB persistence and initial FULL_SYNC.
    pub fn snapshot(&self) -> Vec<u8> {
        self.doc
            .lock()
            .unwrap()
            .export(ExportMode::Snapshot)
            .unwrap_or_default()
    }

    /// Materialised task list — read after every merge to drive UI updates.
    pub fn get_tasks(&self) -> Vec<Task> {
        let doc      = self.doc.lock().unwrap();
        let map_val  = doc.get_map("tasks").get_deep_value();
        let mut tasks = Vec::new();

        // LoroValue::Map wraps LoroMapValue which Derefs to FxHashMap<String, LoroValue>
        if let LoroValue::Map(outer) = map_val {
            for (id, entry_val) in outer.iter() {
                if matches!(entry_val, LoroValue::Null) { continue; }
                if let LoroValue::Map(fields) = entry_val {
                    let content = match fields.get("content") {
                        Some(LoroValue::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let is_completed = match fields.get("is_completed") {
                        Some(LoroValue::Bool(b)) => *b,
                        _ => false,
                    };
                    let last_modified = match fields.get("last_modified") {
                        Some(LoroValue::I64(n)) => *n,
                        _ => 0,
                    };
                    tasks.push(Task {
                        id: id.to_string(),
                        content,
                        is_completed,
                        last_modified,
                    });
                }
            }
        }
        tasks
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub fn get_doc_json(&self) -> String {
        let doc = self.doc.lock().unwrap();
        format!("{:?}", doc.get_deep_value())
    }
}
