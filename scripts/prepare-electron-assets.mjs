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

// electron-builder's Linux icon resolver expects `<size>x<size>.png`, not
// macOS iconset names like `icon_512x512.png`.
for (const fileName of fs.readdirSync(iconsetDir)) {
  const source = path.join(iconsetDir, fileName);
  if (!fs.statSync(source).isFile()) {
    continue;
  }
  const match = /^icon_(\d+x\d+)(?:@2x)?\.png$/i.exec(fileName);
  if (!match) {
    continue;
  }
  const size = match[1];
  const isRetina = /@2x/i.test(fileName);
  const destName = isRetina ? `${Number.parseInt(size, 10) * 2}x${Number.parseInt(size, 10) * 2}.png` : `${size}.png`;
  const dest = path.join(linuxIconsDir, destName);
  if (!fs.existsSync(dest) || !isRetina) {
    fs.copyFileSync(source, dest);
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
