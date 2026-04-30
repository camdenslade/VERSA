import { useState, useEffect, useCallback, useRef } from "react";
import { getEngine, type WasmTask } from "../wasm/versaEngine";
import { type KimbuSession } from "./useKimbuAuth";

export interface Task {
  id:           string;
  content:      string;
  isCompleted:  boolean;
  lastModified: number;
}

interface SyncState {
  connected: boolean;
  tasks:     Task[];
  error:     string | null;
}

const RELAY_URL    = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080/sync";
const SNAPSHOT_KEY = "versa.snapshot";

function saveSnapshot(engine: Awaited<ReturnType<typeof getEngine>>) {
  try {
    const snap = engine.snapshot() as Uint8Array;
    const b64  = btoa(String.fromCharCode(...snap));
    localStorage.setItem(SNAPSHOT_KEY, b64);
  } catch { /* non-fatal */ }
}

function loadSnapshot(engine: Awaited<ReturnType<typeof getEngine>>) {
  try {
    const b64 = localStorage.getItem(SNAPSHOT_KEY);
    if (!b64) return;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    engine.merge_update(bytes);
  } catch { /* non-fatal */ }
}

export function useVersaStore(auth: KimbuSession) {
  const [state, setState] = useState<SyncState>({ connected: false, tasks: [], error: null });
  const [retryCount, setRetryCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const authRef = useRef(auth);
  authRef.current = auth;

  useEffect(() => {
    if (!auth.token) return;
    console.log("[versa] effect run, token prefix:", auth.token.slice(0, 20), "retry:", retryCount);

    let cancelled = false;

    (async () => {
      let engine;
      try {
        engine = await getEngine();
      } catch (e) {
        if (!cancelled) setState(s => ({ ...s, error: `WASM init failed: ${e}` }));
        return;
      }

      loadSnapshot(engine);
      const initial = (engine.get_tasks() as WasmTask[]).map(wasmTaskToTask);
      if (!cancelled && initial.length > 0) setState(s => ({ ...s, tasks: initial }));

      const clientID = stableClientID();
      const token    = authRef.current.token;
      if (!token) return;
      const url      = `${RELAY_URL}?token=${encodeURIComponent(token)}`;
      const ws       = new WebSocket(url);
      ws.binaryType  = "arraybuffer";
      wsRef.current  = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState(s => ({ ...s, connected: true, error: null }));
        const snap = new Uint8Array(engine.snapshot() as unknown as ArrayBuffer);
        console.log("[versa] connected, sending snapshot bytes:", snap.length);
        if (snap.length > 0) ws.send(buildFrame(clientID, snap));
      };

      ws.onerror = () => {
        if (!cancelled) setState(s => ({ ...s, error: "WebSocket error" }));
      };

      ws.onmessage = async (evt: MessageEvent) => {
        if (cancelled) return;

        // Control frames are JSON text.
        if (typeof evt.data === "string") {
          try {
            const ctrl = JSON.parse(evt.data) as { type: string };
            if (ctrl.type === "token_expiring_soon") {
              const fresh = await authRef.current.refresh();
              if (fresh && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "reauth", token: fresh }));
              }
            }
          } catch { /* ignore malformed */ }
          return;
        }

        const raw = new Uint8Array(evt.data as ArrayBuffer);
        const payload = stripHeader(raw);
        console.log("[versa] recv blob bytes:", raw.length, "payload bytes:", payload.length);
        try {
          engine.merge_update(payload);
        } catch (e) {
          console.error("[versa] merge_update failed", e);
          return;
        }
        const tasks = (engine.get_tasks() as WasmTask[]).map(wasmTaskToTask);
        console.log("[versa] after merge, tasks:", tasks.length);
        saveSnapshot(engine);
        setState(s => ({ ...s, tasks }));
      };

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 30_000);

      ws.onclose = (evt) => {
        clearInterval(pingInterval);
        if (cancelled) return;
        console.log("[versa] ws closed code:", evt.code, "reason:", evt.reason, "clean:", evt.wasClean);
        setState(s => ({ ...s, connected: false }));
        if (evt.code === 1008 || evt.code === 4001) {
          authRef.current.refresh();
        } else {
          setTimeout(() => { if (!cancelled) setRetryCount(n => n + 1); }, 2000);
        }
      };
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [auth.token, retryCount]);

  const addTask = useCallback(async (content: string) => {
    const engine = await getEngine();
    const id  = crypto.randomUUID();
    const ts  = Date.now();
    const diff = new Uint8Array(engine.apply_task(id, content, false, ts) as unknown as ArrayBuffer);
    saveSnapshot(engine);
    setState(s => ({ ...s, tasks: [...s.tasks, { id, content, isCompleted: false, lastModified: ts }] }));
    sendDiff(diff);
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    const engine = await getEngine();
    const diff = new Uint8Array(engine.delete_task(id) as unknown as ArrayBuffer);
    saveSnapshot(engine);
    setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }));
    sendDiff(diff);
  }, []);

  const toggleTask = useCallback(async (id: string) => {
    const engine = await getEngine();
    setState(prev => {
      const tasks = prev.tasks.map(t =>
        t.id === id ? { ...t, isCompleted: !t.isCompleted, lastModified: Date.now() } : t
      );
      const updated = tasks.find(t => t.id === id)!;
      (async () => {
        const diff = new Uint8Array(
          engine.apply_task(updated.id, updated.content, updated.isCompleted, updated.lastModified) as unknown as ArrayBuffer
        );
        saveSnapshot(engine);
        sendDiff(diff);
      })();
      return { ...prev, tasks };
    });
  }, []);

  function sendDiff(diff: Uint8Array) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(buildFrame(stableClientID(), diff));
  }

  return {
    tasks:     state.tasks,
    connected: state.connected,
    error:     state.error ?? auth.error,
    authLoading: auth.loading,
    addTask,
    toggleTask,
    deleteTask,
  };
}

// MARK: - Helpers

function stableClientID(): string {
  const key = "versa.client_id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

function wasmTaskToTask(t: WasmTask): Task {
  return { id: t.id, content: t.content, isCompleted: t.is_completed, lastModified: t.last_modified };
}

function buildFrame(clientID: string, payload: Uint8Array): ArrayBuffer {
  const idBytes = new TextEncoder().encode(clientID);
  const frame   = new Uint8Array(4 + idBytes.length + payload.length);
  new DataView(frame.buffer).setUint32(0, idBytes.length, false);
  frame.set(idBytes, 4);
  frame.set(payload, 4 + idBytes.length);
  return frame.buffer;
}

function stripHeader(data: Uint8Array): Uint8Array {
  if (data.length < 4) return data;
  const idLen = new DataView(data.buffer).getUint32(0, false);
  return data.slice(4 + idLen);
}
