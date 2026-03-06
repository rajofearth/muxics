import fs from "fs";
import { ensureAppDataDirs, LIBRARY_CACHE_PATH } from "./paths";
import { formatMetadataTime, getTrackMetadata } from "./metadata";
import { scanFolders } from "./scanner";

const CONCURRENCY = 12;

type CachedTrack = {
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  time: string;
  genre: string;
  picture?: string;
  mtimeMs: number;
  size: number;
};

export type LibraryTrack = Omit<CachedTrack, "mtimeMs" | "size">;

function loadLibraryCache(): Record<string, CachedTrack> {
  ensureAppDataDirs();

  try {
    const raw = fs.readFileSync(LIBRARY_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, CachedTrack>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function saveLibraryCache(cache: Record<string, CachedTrack>): void {
  ensureAppDataDirs();
  fs.writeFileSync(LIBRARY_CACHE_PATH, JSON.stringify(cache), "utf-8");
}

async function mapLimit<T, R>(items: T[], mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function stripCacheFields(track: CachedTrack): LibraryTrack {
  return {
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    time: track.time,
    genre: track.genre,
    picture: track.picture,
  };
}

export async function scanLibrary(paths: string[]): Promise<LibraryTrack[]> {
  const files = scanFolders(paths);
  const existingCache = loadLibraryCache();
  const nextCache: Record<string, CachedTrack> = {};

  const tracks = await mapLimit(files, async (file) => {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(file.path);
    } catch {
      return null;
    }

    const cachedTrack = existingCache[file.path];
    if (cachedTrack && cachedTrack.mtimeMs === stats.mtimeMs && cachedTrack.size === stats.size) {
      nextCache[file.path] = cachedTrack;
      return stripCacheFields(cachedTrack);
    }

    const metadata = await getTrackMetadata(file.path);
    if (!metadata) {
      return null;
    }

    const nextTrack: CachedTrack = {
      path: file.path,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      duration: metadata.duration,
      time: formatMetadataTime(metadata),
      genre: metadata.genre,
      picture: metadata.picture,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };

    nextCache[file.path] = nextTrack;
    return stripCacheFields(nextTrack);
  });

  saveLibraryCache(nextCache);

  return tracks
    .filter((track): track is LibraryTrack => track !== null)
    .sort(
      (left, right) =>
        left.artist.localeCompare(right.artist) ||
        left.album.localeCompare(right.album) ||
        left.title.localeCompare(right.title)
    );
}
