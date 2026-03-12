import fs from "node:fs";
import path from "node:path";
import { AUDIO_EXTENSIONS } from "../../shared/constants";

export interface ScannedFile {
  path: string;
  ext: string;
}

export function scanFolders(folders: string[]): ScannedFile[] {
  const seen = new Set<string>();
  const results: ScannedFile[] = [];

  for (const folder of folders) {
    const resolved = path.resolve(folder);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      continue;
    }

    walk(resolved, results, seen);
  }

  return results;
}

function walk(dir: string, results: ScannedFile[], seen: Set<string>): void {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.warn("Scanner could not read directory:", dir, error);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, results, seen);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      continue;
    }

    const normalized = path.normalize(fullPath);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push({ path: normalized, ext });
  }
}
