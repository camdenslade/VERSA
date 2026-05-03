use std::sync::Mutex;
use loro::{ExportMode, LoroDoc, LoroValue};
use crate::types::{List, Task, VersaError};

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
    pub fn apply_task(&self, task: Task) -> Result<Vec<u8>, VersaError> {
        let doc = self.doc.lock().unwrap();
        let before_vv = doc.oplog_vv();

        let tasks_map = doc.get_map("tasks");
        let entry = tasks_map
            .insert_container(&task.id, loro::LoroMap::new())
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

        entry.insert("list_id",       task.list_id.as_str())
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("content",       task.content.as_str())
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("is_completed",  task.is_completed)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("position",      task.position)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("last_modified", task.last_modified)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

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

    pub fn apply_list(&self, list: List) -> Result<Vec<u8>, VersaError> {
        let doc = self.doc.lock().unwrap();
        let before_vv = doc.oplog_vv();

        let lists_map = doc.get_map("lists");
        let entry = lists_map
            .insert_container(&list.id, loro::LoroMap::new())
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

        entry.insert("name",          list.name.as_str())
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        entry.insert("last_modified", list.last_modified)
             .map_err(|e| VersaError::MergeFailure(e.to_string()))?;

        doc.export(ExportMode::updates(&before_vv))
           .map_err(|e| VersaError::Serialization(e.to_string()))
    }

    pub fn delete_list(&self, id: String) -> Result<Vec<u8>, VersaError> {
        let doc = self.doc.lock().unwrap();
        let before_vv = doc.oplog_vv();
        let lists_map = doc.get_map("lists");
        lists_map.delete(&id)
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        doc.export(ExportMode::updates(&before_vv))
           .map_err(|e| VersaError::Serialization(e.to_string()))
    }

    /// Merge a binary diff received from the Go relay.
    pub fn merge_update(&self, bytes: Vec<u8>) -> Result<(), VersaError> {
        let doc = self.doc.lock().unwrap();
        doc.import(&bytes)
            .map(|_| ())
            .map_err(|e| VersaError::MergeFailure(e.to_string()))?;
        doc.checkout_to_latest();
        Ok(())
    }

    /// Full snapshot for persistence and initial FULL_SYNC.
    pub fn snapshot(&self) -> Vec<u8> {
        self.doc
            .lock()
            .unwrap()
            .export(ExportMode::Snapshot)
            .unwrap_or_default()
    }

    pub fn get_tasks(&self) -> Vec<Task> {
        let doc     = self.doc.lock().unwrap();
        let map_val = doc.get_map("tasks").get_deep_value();
        let mut tasks = Vec::new();

        if let LoroValue::Map(outer) = map_val {
            for (id, entry_val) in outer.iter() {
                if matches!(entry_val, LoroValue::Null) { continue; }
                if let LoroValue::Map(fields) = entry_val {
                    let content = match fields.get("content") {
                        Some(LoroValue::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let list_id = match fields.get("list_id") {
                        Some(LoroValue::String(s)) => s.to_string(),
                        _ => "default".to_string(),
                    };
                    let is_completed = match fields.get("is_completed") {
                        Some(LoroValue::Bool(b)) => *b,
                        _ => false,
                    };
                    let position = match fields.get("position") {
                        Some(LoroValue::I64(n)) => *n,
                        _ => 0,
                    };
                    let last_modified = match fields.get("last_modified") {
                        Some(LoroValue::I64(n)) => *n,
                        _ => 0,
                    };
                    tasks.push(Task { id: id.to_string(), list_id, content, is_completed, position, last_modified });
                }
            }
        }
        tasks.sort_unstable_by(|a, b| a.position.cmp(&b.position).then(a.last_modified.cmp(&b.last_modified)));
        tasks
    }

    pub fn get_lists(&self) -> Vec<List> {
        let doc     = self.doc.lock().unwrap();
        let map_val = doc.get_map("lists").get_deep_value();
        let mut lists = Vec::new();

        if let LoroValue::Map(outer) = map_val {
            for (id, entry_val) in outer.iter() {
                if matches!(entry_val, LoroValue::Null) { continue; }
                if let LoroValue::Map(fields) = entry_val {
                    let name = match fields.get("name") {
                        Some(LoroValue::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let last_modified = match fields.get("last_modified") {
                        Some(LoroValue::I64(n)) => *n,
                        _ => 0,
                    };
                    lists.push(List { id: id.to_string(), name, last_modified });
                }
            }
        }
        lists
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }
}
