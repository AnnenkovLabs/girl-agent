import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "..", "dist", "webui"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022"
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true }
    }
  }
});
