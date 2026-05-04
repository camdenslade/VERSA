import { useState, useEffect, useCallback, useRef } from "react";
import { getEngine, type WasmTask, type WasmList } from "../wasm/versaEngine";
import { type KimbuSession } from "./useKimbuAuth";

export interface Task {
  id:           string;
  listId:       string;
  content:      string;
  isCompleted:  boolean;
  position:     number;
  lastModified: number;
}

export interface List {
  id:           string;
  name:         string;
  lastModified: number;
}

interface SyncState {
  connected: boolean;
  tasks:     Task[];
  lists:     List[];
  error:     string | null;
}

const RELAY_URL    = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080/sync";
const SNAPSHOT_KEY = "versa.snapshot";
const QUEUE_KEY    = "versa.offline_queue";
const DEBOUNCE_MS  = 300;

function saveSnapshot(engine: Awaited<ReturnType<typeof getEngine>>) {
  try {
    const snap = engine.snapshot();
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

function loadQueue(): Uint8Array[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as string[]).map(b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  } catch { return []; }
}

function saveQueue(queue: Uint8Array[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.map(u => btoa(String.fromCharCode(...u)))));
  } catch { /* storage full -- non-fatal */ }
}

function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

function wasmTaskToTask(t: WasmTask): Task {
  return { id: t.id, listId: t.list_id, content: t.content, isCompleted: t.is_completed, position: t.position, lastModified: t.last_modified };
}

function wasmListToList(l: WasmList): List {
  return { id: l.id, name: l.name, lastModified: l.last_modified };
}

export function useVersaStore(auth: KimbuSession) {
  const [state, setState]           = useState<SyncState>({ connected: false, tasks: [], lists: [], error: null });
  const [retryCount, setRetryCount] = useState(0);
  const wsRef      = useRef<WebSocket | null>(null);
  const queueRef   = useRef<Uint8Array[]>(loadQueue());
  const authRef    = useRef(auth);
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  authRef.current  = auth;

  useEffect(() => {
    if (!auth.token) return;
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
      const initialTasks = engine.get_tasks().map(wasmTaskToTask);
      const initialLists = engine.get_lists().map(wasmListToList);
      if (!cancelled) setState(s => ({ ...s, tasks: initialTasks, lists: initialLists }));

      const clientID = stableClientID();
      let token = authRef.current.token;
      if (retryCount > 0) {
        try {
          const fresh = await authRef.current.refresh();
          if (fresh) token = fresh;
        } catch { /* use existing token */ }
      }
      if (!token) return;
      console.log(`[versa] connecting to ${RELAY_URL} (retry ${retryCount})`);
      const ws       = new WebSocket(`${RELAY_URL}?token=${encodeURIComponent(token)}`);
      ws.binaryType  = "arraybuffer";
      wsRef.current  = ws;

      ws.onopen = () => {
        if (cancelled) return;
        console.log("[versa] connected");
        setState(s => ({ ...s, connected: true, error: null }));
        const snap = engine.snapshot();
        if (snap.length > 0) ws.send(buildFrame(clientID, snap));
        const pending = queueRef.current.splice(0);
        clearQueue();
        for (const diff of pending) ws.send(buildFrame(clientID, diff));
      };

      ws.onerror = (e) => {
        console.error("[versa] WebSocket error", e);
        if (!cancelled) setState(s => ({ ...s, error: "WebSocket error" }));
      };

      ws.onmessage = async (evt: MessageEvent) => {
        if (cancelled) return;
        if (typeof evt.data === "string") {
          try {
            const ctrl = JSON.parse(evt.data) as { type: string };
            if (ctrl.type === "token_expiring_soon") {
              const fresh = await authRef.current.refresh();
              if (fresh && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "reauth", token: fresh }));
            }
          } catch { /* ignore malformed */ }
          return;
        }
        const payload = stripHeader(new Uint8Array(evt.data as ArrayBuffer));
        try {
          engine.merge_update(payload);
        } catch (e) {
          console.error("[versa] merge_update failed", e);
          return;
        }
        const tasks = engine.get_tasks().map(wasmTaskToTask);
        const lists = engine.get_lists().map(wasmListToList);
        saveSnapshot(engine);
        setState(s => ({ ...s, tasks, lists }));
      };

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 30_000);

      ws.onclose = (evt) => {
        clearInterval(pingInterval);
        console.warn(`[versa] disconnected code=${evt.code} reason="${evt.reason}" wasClean=${evt.wasClean}`);
        if (cancelled) return;
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

  function sendDiff(diff: Uint8Array) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(buildFrame(stableClientID(), diff));
    } else {
      queueRef.current.push(diff);
      saveQueue(queueRef.current);
    }
  }

  // Tasks

  const addTask = useCallback(async (content: string, listId: string = "default") => {
    const engine = await getEngine();
    const id       = crypto.randomUUID();
    const position = Date.now();
    const ts       = position;
    const diff = engine.apply_task(id, listId, content, false, position, ts);
    saveSnapshot(engine);
    setState(s => ({ ...s, tasks: [...s.tasks, { id, listId, content, isCompleted: false, position, lastModified: ts }] }));
    sendDiff(diff);
  }, []);

  const updateTask = useCallback(async (id: string, content: string) => {
    setState(s => ({
      ...s,
      tasks: s.tasks.map(t => t.id === id ? { ...t, content, lastModified: Date.now() } : t),
    }));

    const existing = debounceRef.current.get(id);
    if (existing) clearTimeout(existing);

    debounceRef.current.set(id, setTimeout(async () => {
      debounceRef.current.delete(id);
      const engine = await getEngine();
      setState(prev => {
        const task = prev.tasks.find(t => t.id === id);
        if (!task) return prev;
        const ts   = Date.now();
        const diff = engine.apply_task(id, task.listId, task.content, task.isCompleted, task.position, ts);
        saveSnapshot(engine);
        sendDiff(diff);
        return { ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, lastModified: ts } : t) };
      });
    }, DEBOUNCE_MS));
  }, []);

  const toggleTask = useCallback(async (id: string) => {
    const engine = await getEngine();
    setState(prev => {
      const task = prev.tasks.find(t => t.id === id);
      if (!task) return prev;
      const ts          = Date.now();
      const isCompleted = !task.isCompleted;
      const diff = engine.apply_task(id, task.listId, task.content, isCompleted, task.position, ts);
      saveSnapshot(engine);
      sendDiff(diff);
      return { ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, isCompleted, lastModified: ts } : t) };
    });
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    const engine = await getEngine();
    const diff = engine.delete_task(id);
    saveSnapshot(engine);
    setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }));
    sendDiff(diff);
  }, []);

  // Lists

  const addList = useCallback(async (name: string) => {
    const engine = await getEngine();
    const id = crypto.randomUUID();
    const ts = Date.now();
    const diff = engine.apply_list(id, name, ts);
    saveSnapshot(engine);
    setState(s => ({ ...s, lists: [...s.lists, { id, name, lastModified: ts }] }));
    sendDiff(diff);
    return id;
  }, []);

  const renameList = useCallback(async (id: string, name: string) => {
    const engine = await getEngine();
    const ts   = Date.now();
    const diff = engine.apply_list(id, name, ts);
    saveSnapshot(engine);
    setState(s => ({ ...s, lists: s.lists.map(l => l.id === id ? { ...l, name, lastModified: ts } : l) }));
    sendDiff(diff);
  }, []);

  const deleteList = useCallback(async (id: string) => {
    const engine = await getEngine();
    const diff = engine.delete_list(id);
    saveSnapshot(engine);
    setState(s => ({
      ...s,
      lists: s.lists.filter(l => l.id !== id),
      // Orphaned tasks move to default rather than being deleted.
      tasks: s.tasks.map(t => t.listId === id ? { ...t, listId: "default" } : t),
    }));
    sendDiff(diff);
  }, []);

  return {
    tasks:      state.tasks,
    lists:      state.lists,
    connected:  state.connected,
    error:      state.error ?? auth.error,
    authLoading: auth.loading,
    addTask,
    updateTask,
    toggleTask,
    deleteTask,
    addList,
    renameList,
    deleteList,
  };
}

// Helpers

function stableClientID(): string {
  const key = "versa.client_id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
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
