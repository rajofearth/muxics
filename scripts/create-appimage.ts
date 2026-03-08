#!/usr/bin/env bun
/**
 * Creates an AppImage from the Electrobun Linux build output.
 * Runs as postPackage hook when ELECTROBUN_OS is linux.
 *
 * Requires: squashfs-tools (for appimagetool), libfuse2 (for running AppImage)
 * On Ubuntu: sudo apt-get install squashfs-tools libfuse2
 */

import { existsSync, mkdirSync, readdirSync, statSync, cpSync, writeFileSync, chmodSync } from "fs";
import { join, dirname, relative } from "path";

const BUILD_DIR = process.env.ELECTROBUN_BUILD_DIR;
const OS = process.env.ELECTROBUN_OS;
const ARCH = process.env.ELECTROBUN_ARCH;
const APP_NAME = process.env.ELECTROBUN_APP_NAME ?? "muse";
const BUILD_ENV = process.env.ELECTROBUN_BUILD_ENV ?? "stable";

if (OS !== "linux") {
  console.log("Skipping AppImage creation (not a Linux build)");
  process.exit(0);
}

if (BUILD_ENV === "dev") {
  console.log("Skipping AppImage creation (dev builds use different output structure)");
  process.exit(0);
}

if (!BUILD_DIR || !existsSync(BUILD_DIR)) {
  console.error("ELECTROBUN_BUILD_DIR not set or does not exist:", BUILD_DIR);
  process.exit(1);
}

// Find all executables (no extension, executable bit set)
function findExecutables(dir: string, acc: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findExecutables(fullPath, acc);
    } else if (entry.isFile() && !entry.name.includes(".")) {
      try {
        const stat = statSync(fullPath);
        if (stat.mode & 0o111) acc.push(fullPath);
      } catch {
        // ignore
      }
    }
  }
  return acc;
}

// Prefer launcher (Electrobun main entry) over bun, bspatch, etc.
const allExecutables = findExecutables(BUILD_DIR);
const executablePath =
  allExecutables.find((p) => p.endsWith("/launcher") || p.endsWith("\\launcher")) ??
  allExecutables.find((p) => p.includes(APP_NAME)) ??
  allExecutables[0];

if (!executablePath) {
  console.error("Could not find executable in build directory:", BUILD_DIR);
  process.exit(1);
}

// Use relative path from BUILD_DIR so exec works when executable is in bin/ etc.
const relativeExecPath = relative(BUILD_DIR, executablePath).replace(/\\/g, "/");
const appDirName = `${APP_NAME}.AppDir`;
const buildParent = dirname(BUILD_DIR);
const appDirPath = join(buildParent, appDirName);
const outputAppImage = join(buildParent, `${APP_NAME}-${ARCH}-${BUILD_ENV}.AppImage`);

console.log("Creating AppDir at:", appDirPath);

// Clean and create AppDir
if (existsSync(appDirPath)) {
  const { rmSync } = await import("fs");
  rmSync(appDirPath, { recursive: true });
}
mkdirSync(appDirPath, { recursive: true });

// Copy entire build output into AppDir
cpSync(BUILD_DIR, join(appDirPath, "usr"), { recursive: true });

// Create AppRun script (launcher is typically in bin/, needs LD_LIBRARY_PATH for .so files)
const libArch = ARCH === "arm64" ? "aarch64" : "x86_64";
const appRun = `#!/bin/bash
APPDIR="$(dirname "$(readlink -f "$0")")"
export PATH="$APPDIR/usr/bin:$APPDIR/usr:$PATH"
export LD_LIBRARY_PATH="$APPDIR/usr/bin:$APPDIR/usr/lib:$APPDIR/usr/lib/${libArch}-linux-gnu:$LD_LIBRARY_PATH"
cd "$APPDIR/usr"
exec "./${relativeExecPath}" "$@"
`;
writeFileSync(join(appDirPath, "AppRun"), appRun);
chmodSync(join(appDirPath, "AppRun"), 0o755);

// Create .desktop file (Exec=AppRun is standard for AppImage)
const appVersion = process.env.ELECTROBUN_APP_VERSION ?? "1.0.0";
const desktop = `[Desktop Entry]
Name=Muse
Exec=AppRun
Icon=muse
Type=Application
Categories=Audio;Music;Player;
Comment=A modern music player
X-AppImage-Name=Muse
X-AppImage-Version=${appVersion}
X-AppImage-Arch=${ARCH === "arm64" ? "aarch64" : "x86_64"}
`;
writeFileSync(join(appDirPath, "muse.desktop"), desktop);

// Create placeholder icon if none exists (AppImage can work without it)
const iconPath = join(appDirPath, "muse.png");
if (!existsSync(iconPath)) {
  // Create minimal 1x1 PNG (valid PNG header)
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  writeFileSync(iconPath, minimalPng);
}

// Download and run appimagetool
const archSuffix = ARCH === "arm64" ? "aarch64" : "x86_64";
const appimagetoolUrl = `https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${archSuffix}.AppImage`;
const appimagetoolPath = join(dirname(BUILD_DIR), "appimagetool.AppImage");

console.log("Downloading appimagetool...");
const resp = await fetch(appimagetoolUrl);
if (!resp.ok) {
  console.error("Failed to download appimagetool:", resp.status, resp.statusText);
  process.exit(1);
}
const toolBuffer = Buffer.from(await resp.arrayBuffer());
writeFileSync(appimagetoolPath, toolBuffer);
chmodSync(appimagetoolPath, 0o755);

console.log("Creating AppImage...");
const proc = Bun.spawn(
  [appimagetoolPath, "--appimage-extract-and-run", appDirPath, outputAppImage],
  {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  }
);

const exitCode = await proc.exited;
if (exitCode !== 0) {
  console.error("appimagetool failed with exit code:", exitCode);
  process.exit(exitCode);
}

console.log("AppImage created:", outputAppImage);
