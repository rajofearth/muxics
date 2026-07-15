import type { TrackPlaybackResult } from "../../shared/desktop-contract";
import { getAudioServerPort } from "./audioServer";
import { log } from "./logger";
import {
  getAudioCacheKey,
  getAudioPathByKey,
  getCachedAudioUrl,
} from "./ytMusicCache";
import { getYtMusicSessionCookie } from "./ytmusicClient";
import { getYtDlpStreamUrl } from "./ytdlp";

function expiresAtFromStreamUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const raw =
      parsed.searchParams.get("expire") ?? parsed.searchParams.get("expires");
    if (!raw) {
      return undefined;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) {
      return undefined;
    }
    return seconds * 1000;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a fresh signed googlevideo (or CDN) stream URL for a YT Music video id.
 * Used by playback IPC and by the local audio proxy when a cached file is missing
 * or the stored source URL returns 403/404 (expired signature, eviction, etc.).
 */
export async function resolveYtMusicDirectStream(
  videoId: string,
): Promise<{ url: string; loudnessDb?: number } | null> {
  try {
    // Get the session cookie so yt-dlp can make authenticated requests
    const cookie = getYtMusicSessionCookie();

    // yt-dlp handles PoT generation, client rotation, cipher/deciphering,
    // format negotiation, and cookie-based auth in a single call.
    const result = await getYtDlpStreamUrl(videoId, cookie);
    if (!result) {
      log("ytmusic", "warn", "yt-dlp could not resolve stream URL", {
        videoId,
      });
      return null;
    }

    log("ytmusic", "info", "Playback URL via yt-dlp", {
      videoId,
      urlLength: result.url.length,
    });

    return result;
  } catch (error) {
    log("ytmusic", "warn", "resolveYtMusicDirectStream failed", {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getYtMusicPlayback(
  trackId: string,
  providerId: string,
): Promise<TrackPlaybackResult> {
  const videoId = providerId || trackId.replace(/^ytmusic:/, "");
  const fallbackExpiresAt = () => Date.now() + 1000 * 60 * 20;

  // ── Cache hit: serve from disk ──────────────────────────────────
  const cacheKey = getAudioCacheKey(videoId);
  const cachedPath = getAudioPathByKey(cacheKey);
  if (cachedPath) {
    return {
      mode: "direct",
      targetId: videoId,
      url: `http://127.0.0.1:${getAudioServerPort()}/play?path=${encodeURIComponent(cachedPath)}`,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
    };
  }

  try {
    // ── Get stream URL from yt-dlp ──────────────────────────────
    // yt-dlp handles PoT generation, client rotation, cipher breaking,
    // format negotiation, and cookie-based auth in a single subprocess call.
    const resolved = await resolveYtMusicDirectStream(videoId);
    if (!resolved?.url) {
      log("ytmusic", "info", "No stream URL from yt-dlp", { videoId });
      return {
        mode: "unavailable",
        targetId: videoId,
        error: "No direct audio stream is available for this track.",
      };
    }

    // ── Return playable URL immediately via audio server proxy ─
    // The audio server streams the googlevideo URL with CORS headers so
    // the <audio crossOrigin="anonymous"> element can access it. It also
    // passes session cookies for authenticated CDN requests.
    //
    // Cache warmup happens asynchronously in the background: the audio
    // server's /yt-cache/audio handler will proxy the stream through
    // and optionally cache it via warmAudioCache on subsequent requests.
    return {
      mode: "direct",
      targetId: videoId,
      url: getCachedAudioUrl(videoId, resolved.url),
      expiresAt: expiresAtFromStreamUrl(resolved.url) ?? fallbackExpiresAt(),
      loudnessDb: resolved.loudnessDb,
    };
  } catch (error) {
    log("ytmusic", "warn", "Playback resolution failed", {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    mode: "unavailable",
    targetId: videoId,
    error: "No direct audio stream is available for this track.",
  };
}
