import fs from "node:fs";
import type { TrackResult } from "../../shared/desktop-contract";
import { YTMUSIC_SEARCH_CACHE_PATH, ensureAppDataDirs } from "./paths";

type SearchCacheFile = {
  epoch: number;
  entries: Record<string, { savedAt: number; results: TrackResult[] }>;
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function loadRaw(): SearchCacheFile {
  ensureAppDataDirs();
  try {
    const raw = fs.readFileSync(YTMUSIC_SEARCH_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SearchCacheFile>;
    return {
      epoch: typeof parsed.epoch === "number" ? parsed.epoch : 0,
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return { epoch: 0, entries: {} };
  }
}

function saveRaw(data: SearchCacheFile): void {
  ensureAppDataDirs();
  fs.writeFileSync(YTMUSIC_SEARCH_CACHE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function bumpYtMusicSearchCacheSession(): void {
  const data = loadRaw();
  saveRaw({
    epoch: data.epoch + 1,
    entries: {},
  });
}

export function getCachedYtMusicSearch(
  query: string,
  ttlMs: number,
): TrackResult[] | null {
  const key = normalizeQuery(query);
  if (!key) return null;

  const data = loadRaw();
  const row = data.entries[key];
  if (!row || Date.now() - row.savedAt > ttlMs) {
    return null;
  }
  return row.results;
}

export function setCachedYtMusicSearch(
  query: string,
  results: TrackResult[],
  maxEntries: number,
): void {
  const key = normalizeQuery(query);
  if (!key) return;

  const data = loadRaw();
  data.entries[key] = { savedAt: Date.now(), results };

  const keys = Object.keys(data.entries);
  if (keys.length > maxEntries) {
    const sorted = keys.sort(
      (a, b) => data.entries[a].savedAt - data.entries[b].savedAt,
    );
    for (let i = 0; i < keys.length - maxEntries; i++) {
      delete data.entries[sorted[i]];
    }
  }

  saveRaw(data);
}

export function clearYtMusicSearchCacheFile(): void {
  try {
    if (fs.existsSync(YTMUSIC_SEARCH_CACHE_PATH)) {
      fs.unlinkSync(YTMUSIC_SEARCH_CACHE_PATH);
    }
  } catch {
    // ignore
  }
}
