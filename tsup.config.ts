import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: ["dist/cli.js"],
  shims: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "telegram",
    "@anthropic-ai/sdk",
    "openai",
    "grammy",
    "@modelcontextprotocol/sdk",
    "ws"
  ]
});
