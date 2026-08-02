import type { Track } from "../types";
import type { DesktopBridge } from "../../shared/desktop-contract";
import { bench } from "../bench";

// ---------------------------------------------------------------------------
// In-memory stream URL cache
//
// Resolved stream URLs from yt-dlp are time-limited (the URL itself carries an
// `expire` query-param).  We cache them here so that when the user clicks
// "next" (or the queue auto-advances) the audio engine can start playback
// immediately without a round-trip through yt-dlp.
//
// Keys are track IDs; values are the resolved URL + its expiry timestamp.
// Entries that are within EXPIRY_MARGIN_MS of expiry are treated as expired
// so the consumer gets a fresh URL before the old one dies.
// ---------------------------------------------------------------------------

interface CachedStream {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CachedStream>();

/** In-flight prefetches keyed by track id (deduplication). */
const inflight = new Map<string, Promise<CachedStream | null>>();

/** Margin before actual expiry: treat entries as stale when we're this close. */
const EXPIRY_MARGIN_MS = 90_000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Synchronously check for a cached (non-expired) stream URL.
 * Returns `undefined` if no entry exists or it is too close to expiry.
 */
export function getCachedStreamUrl(
  trackId: string,
): { url: string; expiresAt: number } | undefined {
  const entry = cache.get(trackId);
  if (!entry) return undefined;
  if (Date.now() + EXPIRY_MARGIN_MS >= entry.expiresAt) {
    cache.delete(trackId);
    return undefined;
  }
  return entry;
}

/**
 * Manually insert (or overwrite) a stream URL for a given track.
 * Used by the stream-refresh and error-recovery paths to keep the cache fresh.
 */
export function setCachedStreamUrl(
  trackId: string,
  url: string,
  expiresAt: number,
): void {
  cache.set(trackId, { url, expiresAt });
}

/** Remove a specific entry (e.g. after a permanent playback failure). */
export function clearCachedStreamUrl(trackId: string): void {
  cache.delete(trackId);
  inflight.delete(trackId);
}

/** Clear the entire cache (e.g. on logout). */
export function clearAllCachedStreamUrls(): void {
  cache.clear();
  inflight.clear();
}

// ── Prefetching ─────────────────────────────────────────────────────────────

/**
 * Resolve (and cache) a stream URL for a single track.
 *
 * Returns the cached entry if already present, or the in-flight promise if a
 * fetch is already underway for this track (deduplication).  This function
 * will NOT throw – failures are silently swallowed and `null` is returned.
 */
export async function prefetchStreamUrl(
  track: Track,
  rpc: DesktopBridge["request"],
): Promise<CachedStream | null> {
  if (track.provider !== "ytmusic") return null;

  const cached = getCachedStreamUrl(track.id);
  if (cached) return cached;

  const existing = inflight.get(track.id);
  if (existing) return existing;

  const promise = (async () => {
    // Bench: prefetch window (design §4.5 playback.preloader-hit). bench.* is
    // a no-op when MUXICS_BENCH=1 is off. Prefetches run with concurrency 3,
    // so the forwarded start/done mark pair can span tracks — the prefetch
    // IPC (ytmusicGetPlayback) is timed independently by the preload wrap.
    bench.mark("streamPreloader:prefetch:start");
    try {
      const playback = await rpc.ytmusicGetPlayback({
        trackId: track.id,
        providerId: track.providerId,
      });
      if (playback.mode !== "direct" || !playback.url) return null;

      const entry: CachedStream = {
        url: playback.url,
        expiresAt: playback.expiresAt ?? Date.now() + 20 * 60 * 1000,
      };
      cache.set(track.id, entry);
      bench.mark("streamPreloader:prefetch:done");
      bench.measure(
        "streamPreloader:prefetch:start → done",
        "streamPreloader:prefetch:start",
        "streamPreloader:prefetch:done",
      );
      return entry;
    } catch {
      // Prefetch failures are non-fatal – the audio engine will fetch on demand.
      return null;
    }
  })();

  inflight.set(track.id, promise);
  promise.finally(() => {
    // Only delete if our promise is still the current one (avoid races).
    if (inflight.get(track.id) === promise) {
      inflight.delete(track.id);
    }
  });

  return promise;
}

// ── Batch prefetch helpers ──────────────────────────────────────────────────

const PREFETCH_CONCURRENCY = 3;

/**
 * Prefetch the next `count` ytmusic tracks in the queue (tracks after the
 * currently-playing one).  Silently skips local tracks and tracks already
 * cached / in-flight.
 */
export function prefetchUpcomingTracks(
  queue: Track[],
  currentTrackId: string | undefined,
  rpc: DesktopBridge["request"] | null,
  count: number = 5,
): void {
  if (!rpc || !currentTrackId || queue.length < 2) return;

  const idx = queue.findIndex((t) => t.id === currentTrackId);
  if (idx < 0 || idx >= queue.length - 1) return;

  const upcoming = queue.slice(idx + 1, idx + 1 + count).filter(
    (t) => t.provider === "ytmusic",
  );
  if (upcoming.length === 0) return;

  let i = 0;
  let running = 0;

  function startNext(): void {
    while (running < PREFETCH_CONCURRENCY && i < upcoming.length) {
      const track = upcoming[i++];
      if (!track) continue;
      // Skip if already cached or in-flight
      if (getCachedStreamUrl(track.id) || inflight.has(track.id)) continue;
      running++;
      prefetchStreamUrl(track, rpc!).finally(() => {
        running--;
        startNext();
      });
    }
  }

  startNext();
}
