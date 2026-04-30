import { useState, useEffect, useCallback, useRef } from "react";
import { getEngine, type WasmTask } from "../wasm/versaEngine";

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

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080/sync";
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

export function useVersaStore() {
  const [state, setState] = useState<SyncState>({ connected: false, tasks: [], error: null });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let engine;
      try {
        engine = await getEngine();
      } catch (e) {
        console.error("[versa] WASM init failed", e);
        if (!cancelled) setState(s => ({ ...s, error: `WASM init failed: ${e}` }));
        return;
      }

      // Load persisted snapshot so UI is instant on mount.
      loadSnapshot(engine);
      const initial = (engine.get_tasks() as WasmTask[]).map(wasmTaskToTask);
      if (!cancelled && initial.length > 0) setState(s => ({ ...s, tasks: initial }));

      const clientID = localStorage.getItem("versa.client_id")!;
      const url = `${RELAY_URL}?client_id=${clientID}`;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState(s => ({ ...s, connected: true, error: null }));
        // Send full snapshot so peers get all our state immediately.
        const snap = new Uint8Array(engine.snapshot() as ArrayBuffer);
        if (snap.length > 0) ws.send(buildFrame(clientID, snap));
      };

      ws.onerror = () => {
        if (!cancelled) setState(s => ({ ...s, error: "WebSocket error — is the relay running?" }));
      };

      ws.onmessage = (evt: MessageEvent<ArrayBuffer>) => {
        if (cancelled) return;
        const payload = stripHeader(new Uint8Array(evt.data));
        try {
          engine.merge_update(payload);
        } catch (e) {
          console.error("[versa] merge_update failed", e);
          return;
        }
        const raw = engine.get_tasks() as WasmTask[];
        saveSnapshot(engine);
        setState(s => ({ ...s, tasks: raw.map(wasmTaskToTask) }));
      };

      ws.onclose = () => {
        if (!cancelled) setState(s => ({ ...s, connected: false }));
      };
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, []);

  const addTask = useCallback(async (content: string) => {
    const engine = await getEngine();
    const id  = crypto.randomUUID();
    const ts  = Date.now();
    const diff = new Uint8Array(engine.apply_task(id, content, false, ts) as ArrayBuffer);
    saveSnapshot(engine);
    setState(s => ({ ...s, tasks: [...s.tasks, { id, content, isCompleted: false, lastModified: ts }] }));
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
          engine.apply_task(updated.id, updated.content, updated.isCompleted, updated.lastModified) as ArrayBuffer
        );
        saveSnapshot(engine);
        sendDiff(diff);
      })();
      return { ...prev, tasks };
    });
  }, []);

  function sendDiff(diff: Uint8Array) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[versa] WebSocket not open, dropping diff");
      return;
    }
    const clientID = localStorage.getItem("versa.client_id")!;
    ws.send(buildFrame(clientID, diff));
  }

  return { tasks: state.tasks, connected: state.connected, error: state.error, addTask, toggleTask };
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
