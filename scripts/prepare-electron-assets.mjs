#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const iconsetDir = path.join(rootDir, "icon.iconset");
const buildDir = path.join(rootDir, "build");
const linuxIconsDir = path.join(buildDir, "icons");

if (!fs.existsSync(iconsetDir)) {
  console.warn("prepare-electron-assets: icon.iconset not found, skipping.");
  process.exit(0);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(linuxIconsDir, { recursive: true, force: true });
fs.mkdirSync(linuxIconsDir, { recursive: true });

for (const fileName of fs.readdirSync(iconsetDir)) {
  const source = path.join(iconsetDir, fileName);
  if (fs.statSync(source).isFile()) {
    fs.copyFileSync(source, path.join(linuxIconsDir, fileName));
  }
}

if (process.platform === "darwin") {
  const iconIcns = path.join(buildDir, "icon.icns");
  const result = spawnSync("iconutil", ["-c", "icns", iconsetDir, "-o", iconIcns], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
