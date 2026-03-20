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
};

type MediaIndex = {
  artwork: Record<string, CacheEntry>;
  audio: Record<string, CacheEntry>;
};

const EMPTY_INDEX: MediaIndex = {
  artwork: {},
  audio: {},
};

const audioWarmups = new Map<string, Promise<void>>();

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

function loadIndex(): MediaIndex {
  ensureAppDataDirs();

  try {
    const raw = fs.readFileSync(YTMUSIC_MEDIA_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MediaIndex>;
    return {
      artwork: parsed.artwork ?? {},
      audio: parsed.audio ?? {},
    };
  } catch {
    return { ...EMPTY_INDEX };
  }
}

function saveIndex(index: MediaIndex): void {
  ensureAppDataDirs();
  fs.writeFileSync(YTMUSIC_MEDIA_INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
}

function getEntryPath(kind: "artwork" | "audio", entry: CacheEntry): string {
  return path.join(kind === "artwork" ? YTMUSIC_ARTWORK_CACHE_DIR : YTMUSIC_AUDIO_CACHE_DIR, entry.fileName);
}

function upsertEntry(kind: "artwork" | "audio", key: string, entry: CacheEntry): void {
  const index = loadIndex();
  index[kind][key] = entry;
  saveIndex(index);
}

function totalAudioUsage(index: MediaIndex): number {
  return Object.values(index.audio).reduce((sum, entry) => sum + entry.size, 0);
}

function totalArtworkUsage(index: MediaIndex): number {
  return Object.values(index.artwork).reduce((sum, entry) => sum + entry.size, 0);
}

function enforceMediaCacheLimit(): void {
  const index = loadIndex();
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

  saveIndex(index);
  notifyYtMusicCacheStatsChanged();
}

export function getArtworkCacheKey(providerId: string, sourceUrl: string): string {
  return hash(`${providerId}:${sourceUrl}`);
}

export function getAudioCacheKey(trackId: string, sourceUrl: string): string {
  return hash(`${trackId}:${sourceUrl}`);
}

export function getCachedArtworkUrl(providerId: string, sourceUrl?: string): string | undefined {
  if (!sourceUrl) {
    return undefined;
  }

  const key = getArtworkCacheKey(providerId, sourceUrl);
  return `http://127.0.0.1:${AUDIO_SERVER_PORT}/yt-cache/artwork?key=${encodeURIComponent(key)}&source=${encodeURIComponent(sourceUrl)}`;
}

export function getCachedAudioUrl(trackId: string, sourceUrl: string): string {
  const key = getAudioCacheKey(trackId, sourceUrl);
  return `http://127.0.0.1:${AUDIO_SERVER_PORT}/yt-cache/audio?key=${encodeURIComponent(key)}&source=${encodeURIComponent(sourceUrl)}`;
}

export function getArtworkPathByKey(key: string): string | null {
  const entry = loadIndex().artwork[key];
  if (!entry) {
    return null;
  }

  const filePath = getEntryPath("artwork", entry);
  return fs.existsSync(filePath) ? filePath : null;
}

export function getAudioPathByKey(key: string): string | null {
  const entry = loadIndex().audio[key];
  if (!entry) {
    return null;
  }

  const filePath = getEntryPath("audio", entry);
  return fs.existsSync(filePath) ? filePath : null;
}

export function touchAudioEntry(key: string): void {
  const index = loadIndex();
  const entry = index.audio[key];
  if (!entry) {
    return;
  }

  entry.updatedAt = Date.now();
  saveIndex(index);
}

export async function ensureArtworkCached(key: string, sourceUrl: string): Promise<string | null> {
  const existing = getArtworkPathByKey(key);
  if (existing) {
    return existing;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Artwork fetch failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  const ext = extensionFromContentType(contentType, sanitizeExtension(path.extname(new URL(sourceUrl).pathname), ".jpg"));
  const fileName = `${key}${ext}`;
  const filePath = path.join(YTMUSIC_ARTWORK_CACHE_DIR, fileName);
  const body = Buffer.from(await response.arrayBuffer());
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

export function warmAudioCache(key: string, sourceUrl: string): Promise<void> {
  const existing = getAudioPathByKey(key);
  if (existing) {
    touchAudioEntry(key);
    return Promise.resolve();
  }

  const inFlight = audioWarmups.get(key);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Audio fetch failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type");
    const ext = extensionFromContentType(contentType, sanitizeExtension(path.extname(new URL(sourceUrl).pathname), ".bin"));
    const fileName = `${key}${ext}`;
    const filePath = path.join(YTMUSIC_AUDIO_CACHE_DIR, fileName);
    const body = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, body);

    upsertEntry("audio", key, {
      fileName,
      sourceUrl,
      size: body.length,
      updatedAt: Date.now(),
      contentType: contentType ?? undefined,
    });

    enforceMediaCacheLimit();
  })().finally(() => {
    audioWarmups.delete(key);
  });

  audioWarmups.set(key, task);
  return task;
}

export function getYtMusicCacheStats(): { usageBytes: number; limitBytes: number } {
  const index = loadIndex();
  return {
    usageBytes: totalAudioUsage(index) + Object.values(index.artwork).reduce((sum, entry) => sum + entry.size, 0),
    limitBytes: loadSettings().ytmusicCacheLimitBytes ?? 1024 * 1024 * 1024,
  };
}

export function clearYtMusicCache(): { success: boolean } {
  const index = loadIndex();

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

  saveIndex({ ...EMPTY_INDEX });
  notifyYtMusicCacheStatsChanged();
  return { success: true };
}
