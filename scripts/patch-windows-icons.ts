#!/usr/bin/env bun
/**
 * Patches packaged Windows executables with the app icon.
 * Intended for CI/release builds after Electrobun finishes packaging.
 */

import { existsSync, copyFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { rcedit } from "rcedit";

function collectExecutables(rootDir: string, matches: string[] = []): string[] {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = join(rootDir, entry.name);

    if (entry.isDirectory()) {
      collectExecutables(fullPath, matches);
      continue;
    }

    if (entry.isFile() && (entry.name === "launcher.exe" || entry.name === "bun.exe")) {
      matches.push(fullPath);
    }
  }

  return matches;
}

export async function patchWindowsIcons(): Promise<void> {
  if (process.platform !== "win32") return;

  const buildRoot = process.env.ELECTROBUN_BUILD_DIR ?? join(process.cwd(), "build");
  if (!existsSync(buildRoot)) {
    console.warn("patch-windows-icons: build directory not found:", buildRoot);
    return;
  }

  const iconPath = join(process.cwd(), "assets", "icon.ico");
  if (!existsSync(iconPath)) {
    console.warn("patch-windows-icons: assets/icon.ico not found");
    return;
  }

  const executables = collectExecutables(buildRoot);
  if (executables.length === 0) {
    console.warn("patch-windows-icons: no packaged executables found in", buildRoot);
    return;
  }

  for (const exe of executables) {
    const tempExe = join(tmpdir(), `rcedit-${randomUUID()}.exe`);
    try {
      copyFileSync(exe, tempExe);
      await rcedit(tempExe, { icon: iconPath });
      copyFileSync(tempExe, exe);
      console.log("Patched icon into:", exe);
    } catch (err) {
      console.warn("Failed to patch", exe, err);
    } finally {
      try {
        if (existsSync(tempExe)) rmSync(tempExe);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

if (import.meta.main) {
  await patchWindowsIcons();
}
