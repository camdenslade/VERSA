use std::sync::Arc;
use crate::engine::CrdtEngine;
use crate::types::{List, Task, VersaError};

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiTask {
    pub id:            String,
    pub list_id:       String,
    pub content:       String,
    pub is_completed:  bool,
    pub position:      i64,
    pub last_modified: i64,
}

impl From<Task> for FfiTask {
    fn from(t: Task) -> Self {
        Self { id: t.id, list_id: t.list_id, content: t.content, is_completed: t.is_completed, position: t.position, last_modified: t.last_modified }
    }
}

impl From<FfiTask> for Task {
    fn from(t: FfiTask) -> Self {
        Self { id: t.id, list_id: t.list_id, content: t.content, is_completed: t.is_completed, position: t.position, last_modified: t.last_modified }
    }
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiList {
    pub id:            String,
    pub name:          String,
    pub last_modified: i64,
}

impl From<List> for FfiList {
    fn from(l: List) -> Self {
        Self { id: l.id, name: l.name, last_modified: l.last_modified }
    }
}

impl From<FfiList> for List {
    fn from(l: FfiList) -> Self {
        Self { id: l.id, name: l.name, last_modified: l.last_modified }
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

#[derive(uniffi::Object)]
pub struct VersaCoreEngine(Arc<CrdtEngine>);

#[uniffi::export]
impl VersaCoreEngine {
    #[uniffi::constructor]
    pub fn new(client_id: String) -> Arc<Self> {
        Arc::new(Self(Arc::new(CrdtEngine::new(client_id))))
    }

    pub fn apply_task(&self, task: FfiTask) -> Result<Vec<u8>, FfiError> {
        self.0.apply_task(task.into()).map_err(Into::into)
    }

    pub fn delete_task(&self, id: String) -> Result<Vec<u8>, FfiError> {
        self.0.delete_task(id).map_err(Into::into)
    }

    pub fn apply_list(&self, list: FfiList) -> Result<Vec<u8>, FfiError> {
        self.0.apply_list(list.into()).map_err(Into::into)
    }

    pub fn delete_list(&self, id: String) -> Result<Vec<u8>, FfiError> {
        self.0.delete_list(id).map_err(Into::into)
    }

    pub fn merge_update(&self, bytes: Vec<u8>) -> Result<(), FfiError> {
        self.0.merge_update(bytes).map_err(Into::into)
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.0.snapshot()
    }

    pub fn get_tasks(&self) -> Vec<FfiTask> {
        self.0.get_tasks().into_iter().map(Into::into).collect()
    }

    pub fn get_lists(&self) -> Vec<FfiList> {
        self.0.get_lists().into_iter().map(Into::into).collect()
    }
}
