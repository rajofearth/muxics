import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AUDIO_SERVER_PORT } from "../../shared/constants";
import {
  YTMUSIC_ARTWORK_CACHE_DIR,
  YTMUSIC_AUDIO_CACHE_DIR,
  YTMUSIC_MEDIA_INDEX_PATH,
  ensureAppDataDirs,
} from "./paths";
import { loadSettings } from "./settings";
import { notifyYtMusicCacheStatsChanged } from "./rendererNotify";

type CacheEntry = {
  fileName: string;
  sourceUrl: string;
  size: number;
  updatedAt: number;
  contentType?: string;
  trackId?: string;
};

type MediaIndex = {
  artwork: Record<string, CacheEntry>;
  audio: Record<string, CacheEntry>;
};

const audioWarmups = new Map<string, Promise<void>>();

const TRUSTED_CACHE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "music.youtube.com",
  "i.ytimg.com",
  "s.ytimg.com",
  "ytimg.com",
  "lh3.googleusercontent.com",
  "yt3.ggpht.com",
]);

function isTrustedCacheUrl(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:") return false;
    // googlevideo.com subdomains (e.g. rr1---sn-xxx.googlevideo.com)
    if (parsed.hostname.endsWith(".googlevideo.com") || parsed.hostname === "googlevideo.com") return true;
    return TRUSTED_CACHE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

let cacheGeneration = 0;

/** In-memory index + batched disk writes (avoids rewriting JSON on every cache hit / LRU touch). */
let indexCache: MediaIndex | null = null;
let indexDirty = false;
let indexFlushTimer: ReturnType<typeof setTimeout> | null = null;

function readIndexFromDisk(): MediaIndex {
  ensureAppDataDirs();
  try {
    const raw = fs.readFileSync(YTMUSIC_MEDIA_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MediaIndex>;
    const index: MediaIndex = {
      artwork: parsed.artwork ?? {},
      audio: parsed.audio ?? {},
    };

    let migrated = false;
    for (const [key, entry] of Object.entries(index.audio)) {
      if (!entry.trackId) {
        try {
          fs.unlinkSync(path.join(YTMUSIC_AUDIO_CACHE_DIR, entry.fileName));
        } catch {}
        delete index.audio[key];
        migrated = true;
      }
    }

    if (migrated) {
      indexCache = index;
      indexDirty = true;
      scheduleIndexFlush();
      setTimeout(() => notifyYtMusicCacheStatsChanged(), 3000);
    }

    return index;
  } catch {
    return { artwork: {}, audio: {} };
  }
}

function getIndex(): MediaIndex {
  if (!indexCache) {
    indexCache = readIndexFromDisk();
  }
  return indexCache;
}

function flushIndexSync(): void {
  if (indexFlushTimer !== null) {
    clearTimeout(indexFlushTimer);
    indexFlushTimer = null;
  }
  if (!indexCache || !indexDirty) {
    return;
  }
  ensureAppDataDirs();
  fs.writeFileSync(YTMUSIC_MEDIA_INDEX_PATH, JSON.stringify(indexCache, null, 2), "utf8");
  indexDirty = false;
}

function scheduleIndexFlush(): void {
  if (indexFlushTimer !== null) {
    return;
  }
  indexFlushTimer = setTimeout(() => {
    indexFlushTimer = null;
    flushIndexSync();
  }, 450);
}

process.once("beforeExit", () => {
  flushIndexSync();
});

function hash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function sanitizeExtension(raw: string | undefined, fallback: string): string {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.startsWith(".") ? raw.toLowerCase() : `.${raw.toLowerCase()}`;
  if (!/^\.[a-z0-9]{1,8}$/.test(normalized)) {
    return fallback;
  }

  return normalized;
}

function extensionFromContentType(contentType: string | null, fallback: string): string {
  if (!contentType) {
    return fallback;
  }

  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("audio/webm")) return ".webm";
  if (contentType.includes("audio/mp4")) return ".m4a";
  if (contentType.includes("audio/mpeg")) return ".mp3";
  if (contentType.includes("audio/ogg")) return ".ogg";

  return fallback;
}

function getEntryPath(kind: "artwork" | "audio", entry: CacheEntry): string {
  return path.join(kind === "artwork" ? YTMUSIC_ARTWORK_CACHE_DIR : YTMUSIC_AUDIO_CACHE_DIR, entry.fileName);
}

function upsertEntry(kind: "artwork" | "audio", key: string, entry: CacheEntry): void {
  const index = getIndex();
  index[kind][key] = entry;
  indexDirty = true;
  scheduleIndexFlush();
}

function totalAudioUsage(index: MediaIndex): number {
  return Object.values(index.audio).reduce((sum, entry) => sum + entry.size, 0);
}

function totalArtworkUsage(index: MediaIndex): number {
  return Object.values(index.artwork).reduce((sum, entry) => sum + entry.size, 0);
}

function enforceMediaCacheLimit(): void {
  const index = getIndex();
  const limit = loadSettings().ytmusicCacheLimitBytes ?? 1024 * 1024 * 1024;
  let usage = totalAudioUsage(index) + totalArtworkUsage(index);
  if (usage <= limit) {
    notifyYtMusicCacheStatsChanged();
    return;
  }

  const audioCandidates = Object.entries(index.audio).sort(
    ([, left], [, right]) => left.updatedAt - right.updatedAt,
  );

  for (const [key, entry] of audioCandidates) {
    if (usage <= limit) {
      break;
    }
    try {
      fs.unlinkSync(getEntryPath("audio", entry));
    } catch {}
    usage -= entry.size;
    delete index.audio[key];
  }

  const artCandidates = Object.entries(index.artwork).sort(
    ([, left], [, right]) => left.updatedAt - right.updatedAt,
  );

  for (const [key, entry] of artCandidates) {
    if (usage <= limit) {
      break;
    }
    try {
      fs.unlinkSync(getEntryPath("artwork", entry));
    } catch {}
    usage -= entry.size;
    delete index.artwork[key];
  }

  indexDirty = true;
  flushIndexSync();
  notifyYtMusicCacheStatsChanged();
}

export function getArtworkCacheKey(providerId: string, sourceUrl: string): string {
  return hash(`${providerId}:${sourceUrl}`);
}

export function getAudioCacheKey(trackId: string): string {
  return hash(`audio_v2:${trackId}`);
}

export function getCachedArtworkUrl(providerId: string, sourceUrl?: string): string | undefined {
  if (!sourceUrl) {
    return undefined;
  }

  const key = getArtworkCacheKey(providerId, sourceUrl);
  return `http://127.0.0.1:${AUDIO_SERVER_PORT}/yt-cache/artwork?key=${encodeURIComponent(key)}&source=${encodeURIComponent(sourceUrl)}`;
}

export function getCachedAudioUrl(trackId: string, sourceUrl: string): string {
  const key = getAudioCacheKey(trackId);
  return `http://127.0.0.1:${AUDIO_SERVER_PORT}/yt-cache/audio?key=${encodeURIComponent(key)}&source=${encodeURIComponent(sourceUrl)}&trackId=${encodeURIComponent(trackId)}`;
}

export function getArtworkPathByKey(key: string): string | null {
  const entry = getIndex().artwork[key];
  if (!entry) {
    return null;
  }

  const filePath = getEntryPath("artwork", entry);
  return fs.existsSync(filePath) ? filePath : null;
}

export function getAudioPathByKey(key: string): string | null {
  const entry = getIndex().audio[key];
  if (!entry) {
    return null;
  }

  const filePath = getEntryPath("audio", entry);
  return fs.existsSync(filePath) ? filePath : null;
}

export function touchAudioEntry(key: string): void {
  const index = getIndex();
  const entry = index.audio[key];
  if (!entry) {
    return;
  }

  entry.updatedAt = Date.now();
  indexDirty = true;
  scheduleIndexFlush();
}

export async function ensureArtworkCached(key: string, sourceUrl: string): Promise<string | null> {
  const existing = getArtworkPathByKey(key);
  if (existing) {
    return existing;
  }

  if (!isTrustedCacheUrl(sourceUrl)) {
    throw new Error(`Artwork URL not on trusted host: ${sourceUrl}`);
  }

  const gen = cacheGeneration;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Artwork fetch failed (${response.status})`);
  }

  if (gen !== cacheGeneration) return null;

  const contentType = response.headers.get("content-type");
  const ext = extensionFromContentType(contentType, sanitizeExtension(path.extname(new URL(sourceUrl).pathname), ".jpg"));
  const fileName = `${key}${ext}`;
  const filePath = path.join(YTMUSIC_ARTWORK_CACHE_DIR, fileName);
  const body = Buffer.from(await response.arrayBuffer());

  if (gen !== cacheGeneration) return null;

  fs.writeFileSync(filePath, body);

  upsertEntry("artwork", key, {
    fileName,
    sourceUrl,
    size: body.length,
    updatedAt: Date.now(),
    contentType: contentType ?? undefined,
  });

  enforceMediaCacheLimit();

  return filePath;
}

export function warmAudioCache(key: string, sourceUrl: string, trackId?: string): Promise<void> {
  const existing = getAudioPathByKey(key);
  if (existing) {
    touchAudioEntry(key);
    return Promise.resolve();
  }

  const inFlight = audioWarmups.get(key);
  if (inFlight) {
    return inFlight;
  }

  if (!isTrustedCacheUrl(sourceUrl)) {
    return Promise.reject(new Error(`Audio URL not on trusted host: ${sourceUrl}`));
  }

  const gen = cacheGeneration;
  const task = (async () => {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          Accept: "*/*",
        }
      });
      if (!response.ok) {
        throw new Error(`Audio fetch failed (${response.status})`);
      }

      if (gen !== cacheGeneration) return;

      const contentType = response.headers.get("content-type");
      const ext = extensionFromContentType(contentType, sanitizeExtension(path.extname(new URL(sourceUrl).pathname), ".bin"));
      const fileName = `${key}${ext}`;
      const filePath = path.join(YTMUSIC_AUDIO_CACHE_DIR, fileName);
      const body = Buffer.from(await response.arrayBuffer());

      if (gen !== cacheGeneration) return;

      fs.writeFileSync(filePath, body);

      upsertEntry("audio", key, {
        fileName,
        sourceUrl,
        size: body.length,
        updatedAt: Date.now(),
        contentType: contentType ?? undefined,
        trackId,
      });

      enforceMediaCacheLimit();
    } catch (err) {
      // Ignored: background fetch failures are expected if stream expires or connection drops.
    }
  })().finally(() => {
    audioWarmups.delete(key);
  });

  audioWarmups.set(key, task);
  return task;
}

export function getFullyCachedTrackIds(): string[] {
  const index = getIndex();
  const ids: string[] = [];
  for (const entry of Object.values(index.audio)) {
    if (entry.trackId) {
      ids.push(entry.trackId);
    }
  }
  return ids;
}

export function getYtMusicCacheStats(): { usageBytes: number; limitBytes: number } {
  const index = getIndex();
  return {
    usageBytes: totalAudioUsage(index) + totalArtworkUsage(index),
    limitBytes: loadSettings().ytmusicCacheLimitBytes ?? 1024 * 1024 * 1024,
  };
}

export function clearYtMusicCache(): { success: boolean } {
  cacheGeneration++;
  const index = getIndex();

  for (const entry of Object.values(index.audio)) {
    try {
      fs.unlinkSync(getEntryPath("audio", entry));
    } catch {}
  }

  for (const entry of Object.values(index.artwork)) {
    try {
      fs.unlinkSync(getEntryPath("artwork", entry));
    } catch {}
  }

  index.audio = {};
  index.artwork = {};
  indexDirty = true;
  flushIndexSync();
  notifyYtMusicCacheStatsChanged();
  return { success: true };
}
