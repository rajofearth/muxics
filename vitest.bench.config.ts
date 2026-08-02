import { defineConfig } from "vitest/config";

// Shared config for the benchmark harness (issue #40+). A bench run is heavy
// (tsup build, Vite child, Electron launch against a scratch app-data copy)
// and must never overlap another run — the app hard-binds 127.0.0.1:46021 and
// Vite uses strictPort on 5173, so file-level parallelism is disabled and
// timeouts are generous.
export default defineConfig({
  test: {
    include: ["benchmarks/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "dist-electron/**"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
