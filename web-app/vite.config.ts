import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// vite-plugin-wasm + top-level-await are required because wasm-bindgen's
// generated JS uses top-level `await` to initialize the WASM module.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  server: { port: 5173 },
});
