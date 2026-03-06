import path from "path";
import fs from "fs";
import { AUDIO_EXTENSIONS } from "../shared/constants";

export interface ScannedFile {
  path: string;
  ext: string;
}

export function scanFolders(folders: string[]): ScannedFile[] {
  const seen = new Set<string>();
  const result: ScannedFile[] = [];

  for (const folder of folders) {
    const resolved = path.resolve(folder);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      continue;
    }

    walk(resolved, result, seen);
  }

  return result;
}

function walk(dir: string, result: ScannedFile[], seen: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn("Scanner could not read:", dir, err);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fullPath, result, seen);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;

    const normalized = path.normalize(fullPath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    result.push({ path: normalized, ext });
  }
}
