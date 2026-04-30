/* tslint:disable */
/* eslint-disable */

export class VersaEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Apply a task mutation. Returns a Uint8Array (binary diff) to send to the relay.
     *
     * CORRECT JS usage:
     *   const diff = new Uint8Array(engine.apply_task(id, content, completed, ts));
     *   ws.send(diff);
     */
    apply_task(id: string, content: string, is_completed: boolean, last_modified: number): Uint8Array;
    delete_task(id: string): Uint8Array;
    /**
     * Debug: returns the full doc as a JSON string.
     */
    get_doc_json(): string;
    /**
     * Returns all tasks as a JS Array of plain objects.
     */
    get_tasks(): WasmTask[];
    /**
     * Merge a binary diff received from the relay WebSocket.
     */
    merge_update(bytes: Uint8Array): void;
    constructor(client_id: string);
    /**
     * Full snapshot for IndexedDB persistence.
     */
    snapshot(): Uint8Array;
}

export class WasmTask {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    content: string;
    id: string;
    is_completed: boolean;
    last_modified: number;
}

export function reverse_string(input: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_wasmtask_content: (a: number) => [number, number];
    readonly __wbg_get_wasmtask_id: (a: number) => [number, number];
    readonly __wbg_get_wasmtask_is_completed: (a: number) => number;
    readonly __wbg_get_wasmtask_last_modified: (a: number) => number;
    readonly __wbg_set_wasmtask_content: (a: number, b: number, c: number) => void;
    readonly __wbg_set_wasmtask_id: (a: number, b: number, c: number) => void;
    readonly __wbg_set_wasmtask_is_completed: (a: number, b: number) => void;
    readonly __wbg_set_wasmtask_last_modified: (a: number, b: number) => void;
    readonly __wbg_versaengine_free: (a: number, b: number) => void;
    readonly __wbg_wasmtask_free: (a: number, b: number) => void;
    readonly reverse_string: (a: number, b: number) => [number, number];
    readonly versaengine_apply_task: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly versaengine_delete_task: (a: number, b: number, c: number) => [number, number, number, number];
    readonly versaengine_get_doc_json: (a: number) => [number, number];
    readonly versaengine_get_tasks: (a: number) => [number, number];
    readonly versaengine_merge_update: (a: number, b: number, c: number) => [number, number];
    readonly versaengine_new: (a: number, b: number) => number;
    readonly versaengine_snapshot: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
