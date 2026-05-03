use wasm_bindgen::prelude::*;
use crate::engine::CrdtEngine;
use crate::types::{List, Task};

#[wasm_bindgen(getter_with_clone)]
pub struct WasmTask {
    pub id:            String,
    pub list_id:       String,
    pub content:       String,
    pub is_completed:  bool,
    pub position:      f64,
    pub last_modified: f64,
}

impl From<Task> for WasmTask {
    fn from(t: Task) -> Self {
        Self {
            id:            t.id,
            list_id:       t.list_id,
            content:       t.content,
            is_completed:  t.is_completed,
            position:      t.position as f64,
            last_modified: t.last_modified as f64,
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmList {
    pub id:            String,
    pub name:          String,
    pub last_modified: f64,
}

impl From<List> for WasmList {
    fn from(l: List) -> Self {
        Self { id: l.id, name: l.name, last_modified: l.last_modified as f64 }
    }
}

#[wasm_bindgen]
pub struct VersaEngine {
    inner: CrdtEngine,
}

#[wasm_bindgen]
impl VersaEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(client_id: String) -> Self {
        #[cfg(feature = "wasm")]
        console_error_panic_hook::set_once();
        Self { inner: CrdtEngine::new(client_id) }
    }

    #[wasm_bindgen]
    pub fn apply_task(
        &self,
        id:            String,
        list_id:       String,
        content:       String,
        is_completed:  bool,
        position:      f64,
        last_modified: f64,
    ) -> Result<Vec<u8>, JsValue> {
        let task = Task { id, list_id, content, is_completed, position: position as i64, last_modified: last_modified as i64 };
        self.inner.apply_task(task).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn delete_task(&self, id: String) -> Result<Vec<u8>, JsValue> {
        self.inner.delete_task(id).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn apply_list(&self, id: String, name: String, last_modified: f64) -> Result<Vec<u8>, JsValue> {
        let list = List { id, name, last_modified: last_modified as i64 };
        self.inner.apply_list(list).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn delete_list(&self, id: String) -> Result<Vec<u8>, JsValue> {
        self.inner.delete_list(id).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn merge_update(&self, bytes: &[u8]) -> Result<(), JsValue> {
        self.inner.merge_update(bytes.to_vec()).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn snapshot(&self) -> Vec<u8> {
        self.inner.snapshot()
    }

    #[wasm_bindgen]
    pub fn get_tasks(&self) -> Vec<WasmTask> {
        self.inner.get_tasks().into_iter().map(Into::into).collect()
    }

    #[wasm_bindgen]
    pub fn get_lists(&self) -> Vec<WasmList> {
        self.inner.get_lists().into_iter().map(Into::into).collect()
    }

}
