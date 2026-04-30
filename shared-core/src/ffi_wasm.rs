// wasm-bindgen surface — TypeScript / Web bindings.
// This file only compiles when --features wasm is set (wasm32 target).
//
// ── Memory model ─────────────────────────────────────────────────────────────
// Wasm linear memory is a flat ArrayBuffer shared between JS and Wasm.
// wasm-bindgen copies Vec<u8> → JS Uint8Array on every boundary crossing.
//
// ⚠ PITFALL 1 — Dangling Uint8Array:
//   let ptr = engine.apply_task(task);   // Uint8Array backed by Wasm heap
//   await sendToRelay(ptr);              // ← WRONG: Wasm GC may have moved memory
//   // CORRECT: copy immediately: const diff = new Uint8Array(engine.apply_task(task));
//
// ⚠ PITFALL 2 — Forgetting free():
//   Every `#[wasm_bindgen]` struct allocated with `new` must be `.free()`d in JS
//   unless you annotate it with `#[wasm_bindgen(gc_mark)]` (experimental).
//   Use a try/finally block or a using() helper.
//
// ⚠ PITFALL 3 — Panics become JS exceptions:
//   Set `console_error_panic_hook` in your wasm_init to get readable stack traces.

use wasm_bindgen::prelude::*;
use crate::engine::CrdtEngine;
use crate::types::Task;

// ── JS-visible Task ───────────────────────────────────────────────────────────
// We use a plain object shape so TypeScript gets a clean interface without
// having to call into Wasm for property reads.

#[wasm_bindgen(getter_with_clone)]
pub struct WasmTask {
    pub id:            String,
    pub content:       String,
    pub is_completed:  bool,
    pub last_modified: f64, // JS Number (i64 is not natively representable in JS)
}

impl From<Task> for WasmTask {
    fn from(t: Task) -> Self {
        Self {
            id:            t.id,
            content:       t.content,
            is_completed:  t.is_completed,
            last_modified: t.last_modified as f64,
        }
    }
}

// ── Exported engine ───────────────────────────────────────────────────────────
#[wasm_bindgen]
pub struct VersaEngine {
    inner: CrdtEngine,
}

#[wasm_bindgen]
impl VersaEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(client_id: String) -> Self {
        // Install the panic hook once at construction time.
        #[cfg(feature = "wasm")]
        console_error_panic_hook::set_once();

        Self { inner: CrdtEngine::new(client_id) }
    }

    /// Apply a task mutation. Returns a Uint8Array (binary diff) to send to the relay.
    ///
    /// CORRECT JS usage:
    ///   const diff = new Uint8Array(engine.apply_task(id, content, completed, ts));
    ///   ws.send(diff);
    #[wasm_bindgen]
    pub fn apply_task(
        &self,
        id:            String,
        content:       String,
        is_completed:  bool,
        last_modified: f64,
    ) -> Result<Vec<u8>, JsValue> {
        let task = Task {
            id,
            content,
            is_completed,
            last_modified: last_modified as i64,
        };
        self.inner
            .apply_task(task)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Merge a binary diff received from the relay WebSocket.
    #[wasm_bindgen]
    pub fn merge_update(&self, bytes: &[u8]) -> Result<(), JsValue> {
        self.inner
            .merge_update(bytes.to_vec())
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Full snapshot for IndexedDB persistence.
    #[wasm_bindgen]
    pub fn snapshot(&self) -> Vec<u8> {
        self.inner.snapshot()
    }

    /// Returns all tasks as a JS Array of plain objects.
    #[wasm_bindgen]
    pub fn get_tasks(&self) -> Vec<WasmTask> {
        self.inner.get_tasks().into_iter().map(Into::into).collect()
    }

    /// Debug: returns the full doc as a JSON string.
    #[wasm_bindgen]
    pub fn get_doc_json(&self) -> String {
        self.inner.get_doc_json()
    }
}

// Bridge validation
#[wasm_bindgen]
pub fn reverse_string(input: String) -> String {
    input.chars().rev().collect()
}
