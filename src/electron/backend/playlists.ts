import fs from "node:fs";
import path from "node:path";
import { PLAYLISTS_DIR, ensureAppDataDirs } from "./paths";

export interface PlaylistEntry {
  path: string;
  title?: string;
}

export interface Playlist {
  name: string;
  path: string;
  entries: PlaylistEntry[];
}

function parseM3U(content: string, baseDir: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentTitle: string | undefined;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/^#EXTINF:\d+,(.+)$/);
      currentTitle = match?.[1]?.trim();
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const filePath = path.isAbsolute(line) ? line : path.resolve(baseDir, line);
    entries.push({ path: filePath, title: currentTitle });
    currentTitle = undefined;
  }

  return entries;
}

function parsePLS(content: string, baseDir: string): PlaylistEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const files: string[] = [];
  const titles: string[] = [];

  for (const line of lines) {
    const fileMatch = line.match(/^File(\d+)=(.+)$/i);
    if (fileMatch) {
      const index = Number.parseInt(fileMatch[1], 10) - 1;
      const filePath = path.isAbsolute(fileMatch[2].trim())
        ? fileMatch[2].trim()
        : path.resolve(baseDir, fileMatch[2].trim());
      files[index] = filePath;
    }

    const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
    if (titleMatch) {
      const index = Number.parseInt(titleMatch[1], 10) - 1;
      titles[index] = titleMatch[2].trim();
    }
  }

  const entries: PlaylistEntry[] = [];
  for (let index = 0; index < files.length; index++) {
    const filePath = files[index];
    if (filePath) {
      entries.push({ path: filePath, title: titles[index] });
    }
  }
  return entries;
}

export function loadPlaylist(filePath: string): Playlist | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();
    const baseDir = path.dirname(filePath);
    const name = path.basename(filePath, ext);
    const entries = ext === ".pls" ? parsePLS(content, baseDir) : parseM3U(content, baseDir);
    return { name, path: filePath, entries };
  } catch {
    return null;
  }
}

export function savePlaylist(targetPath: string, name: string, entries: string[]): void {
  ensureAppDataDirs();

  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    lines.push(`#EXTINF:0,${path.basename(entry)}`);
    lines.push(entry);
  }

  fs.writeFileSync(path.join(targetPath, `${name}.m3u8`), lines.join("\n"), "utf-8");
}

export function listPlaylists(): Playlist[] {
  ensureAppDataDirs();

  try {
    const files = fs.readdirSync(PLAYLISTS_DIR);
    return files
      .filter((fileName) => fileName.endsWith(".m3u8") || fileName.endsWith(".m3u"))
      .map((fileName) => loadPlaylist(path.join(PLAYLISTS_DIR, fileName)))
      .filter((playlist): playlist is Playlist => playlist !== null);
  } catch {
    return [];
  }
}
