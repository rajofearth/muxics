import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/electron/main.ts",
    preload: "src/electron/preload.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir: "dist-electron",
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  outExtension: () => ({
    js: ".cjs",
  }),
  external: ["electron", "electron-updater"],
  noExternal: ["music-metadata", "token-types", "ieee754"],
});
