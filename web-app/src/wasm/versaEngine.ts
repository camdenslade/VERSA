// Manages the WASM module lifecycle.
//
// ── Memory pitfalls ───────────────────────────────────────────────────────────
// 1. NEVER hold a reference to a Uint8Array returned by the WASM module across
//    an `await` point.  The WASM heap can be moved by a subsequent allocation.
//    Always copy: `const safe = new Uint8Array(wasm.apply_task(...))`
//
// 2. VersaEngine is a Rust struct allocated on the WASM heap.  Call `.free()`
//    when done, or the memory leaks.  In practice, create one instance per app
//    session and never free it — the tab dying cleans up.
//
// 3. wasm-bindgen panics surface as JS exceptions.  The panic hook in ffi_wasm.rs
//    routes them through console.error with a stack trace.

import type { VersaEngine as WasmVersaEngine, WasmTask } from "./pkg/versa_core";

let _engine: WasmVersaEngine | null = null;
let _initPromise: Promise<WasmVersaEngine> | null = null;

export async function getEngine(): Promise<WasmVersaEngine> {
  if (_engine) return _engine;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Dynamic import so Vite can code-split the WASM bundle.
    const { default: init, VersaEngine } = await import("./pkg/versa_core");
    await init(); // runs the WASM start function
    const clientID = getOrCreateClientID();
    _engine = new VersaEngine(clientID);
    return _engine;
  })();

  return _initPromise;
}

function getOrCreateClientID(): string {
  const key = "versa.client_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export type { WasmTask };
