import type { VersaEngine as WasmVersaEngine, WasmTask, WasmList } from "./pkg/versa_core";

let _engine: WasmVersaEngine | null = null;
let _initPromise: Promise<WasmVersaEngine> | null = null;

export async function getEngine(): Promise<WasmVersaEngine> {
  if (_engine) return _engine;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { VersaEngine } = await import("./pkg/versa_core");
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

export type { WasmTask, WasmList };
