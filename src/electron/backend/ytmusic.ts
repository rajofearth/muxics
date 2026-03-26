import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Innertube, Misc, YTNodes } from "youtubei.js";

type MusicResponsiveListItem = InstanceType<typeof YTNodes.MusicResponsiveListItem>;
type MusicTwoRowItem = InstanceType<typeof YTNodes.MusicTwoRowItem>;
type Format = InstanceType<typeof Misc.Format>;
import type {
  AuthLoginCompleteResult,
  AuthLoginStartResult,
  AuthStatusResult,
  ImportYtMusicSessionResult,
  PendingYtMusicLoginResult,
  PlaylistResult,
  TrackPlaybackResult,
  TrackResult,
  YTMusicHomeFeedResult,
  YTMusicHomeResult,
  YTMusicHomeSectionResult,
  YTMusicLibrarySyncResult,
} from "../../shared/desktop-contract";
import { loadSettings } from "./settings";
import { ensureAppDataDirs, YTMUSIC_CACHE_PATH, YTMUSIC_DEBUG_DIR, YTMUSIC_HOME_SNAPSHOT_PATH } from "./paths";
import { bumpYtMusicSearchCacheSession, clearYtMusicSearchCacheFile } from "./ytmusicSearchCache";
import { log } from "./logger";
import { getCachedArtworkUrl, getCachedAudioUrl, getAudioCacheKey, getAudioPathByKey } from "./ytMusicCache";
import { getAudioServerPort } from "./audioServer";
import {
  clearStoredYtMusicSession,
  loadStoredYtMusicSession,
  persistCookieString,
  persistOAuthTokens,
} from "./ytmusicSession";
import { formatDuration, readDurationSeconds, sanitizeText } from "./ytmusicStrings";

type CacheShape = {
  tracks: TrackResult[];
  playlists: PlaylistResult[];
  lastSyncedAt?: number;
};

type PendingLoginState = {
  id: number;
  challenge: PendingYtMusicLoginResult;
  completion: Promise<AuthLoginCompleteResult>;
  canceled: boolean;
};

type ImportedSessionDetails = {
  cookieNames?: string[];
  sourceUrl?: string;
};

type LibraryAuthState =
  | { authenticated: true; message?: undefined }
  | { authenticated: false; message: string };

let cachedClient: Innertube | null = null;
let cachedAuthStatus: AuthStatusResult | null = null;
let pendingLogin: PendingLoginState | null = null;
let loggedLibraryAuthDebug = false;
let installedPlayerEvaluator = false;
const require = createRequire(__filename);

const YTMUSIC_ORIGIN = "https://music.youtube.com";
const YTMUSIC_CLIENT_NAME = "WEB_REMIX";
const YTMUSIC_CLIENT_ID = "67";
const REQUIRED_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
  "APISID",
] as const;
const DIAGNOSTIC_COOKIE_NAMES = [
  ...REQUIRED_COOKIE_NAMES,
  "SID",
  "HSID",
  "SSID",
] as const;

async function ensurePlayerEvaluator(): Promise<void> {
  if (installedPlayerEvaluator) {
    return;
  }

  const packageJsonPath = require.resolve("youtubei.js/package.json");
  const utilsPath = path.join(path.dirname(packageJsonPath), "dist", "src", "utils", "Utils.js");
  const { Platform } = await import(pathToFileURL(utilsPath).href);

  // youtubei.js appends `return process(...)` to the extracted player script (see getNsigProcessorFn).
  // vm.runInContext treats that as script code, where top-level `return` is a SyntaxError.
  // Match https://ytjs.dev/guide/getting-started.html — run as a function body via `Function`.
  Platform.shim.eval = async (data: { output?: string }, env: Record<string, unknown>) => {
    const names = Object.keys(env);
    const values = names.map((key) => env[key]);
    const body = String(data.output ?? "");
    const runner = new Function(...names, body);
    return runner(...values);
  };

  installedPlayerEvaluator = true;
}

function getCookieValue(cookie: string | undefined, name: string): string | undefined {
  if (!cookie) {
    return undefined;
  }

  const part = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return part ? part.slice(name.length + 1) : undefined;
}

function createSapisdHash(cookie: string): string | null {
  const sid =
    getCookieValue(cookie, "SAPISID") ||
    getCookieValue(cookie, "__Secure-3PAPISID") ||
    getCookieValue(cookie, "__Secure-1PAPISID") ||
    getCookieValue(cookie, "APISID");

  if (!sid) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash("sha1")
    .update(`${timestamp} ${sid} ${YTMUSIC_ORIGIN}`, "utf8")
    .digest("hex");

  return `SAPISIDHASH ${timestamp}_${hash}`;
}

function getCookiePresence(cookie: string | undefined): Record<string, boolean> {
  return Object.fromEntries(
    DIAGNOSTIC_COOKIE_NAMES.map((name) => [name, Boolean(getCookieValue(cookie, name))]),
  );
}

function hasRequiredAuthCookie(cookie: string | undefined): boolean {
  return REQUIRED_COOKIE_NAMES.some((name) => Boolean(getCookieValue(cookie, name)));
}

function getYtMusicRequestContext(headers: Headers, body?: string) {
  const clientId = headers.get("X-Youtube-Client-Name") ?? "";
  let clientName = "";
  let browseId = "";

  if (body) {
    try {
      const parsed = JSON.parse(body) as {
        context?: { client?: { clientName?: string } };
        browseId?: string;
      };
      clientName = parsed.context?.client?.clientName ?? "";
      browseId = parsed.browseId ?? "";
    } catch {}
  }

  return {
    clientId,
    clientName,
    browseId,
    isYtMusicRequest: clientId === YTMUSIC_CLIENT_ID || clientName === YTMUSIC_CLIENT_NAME,
  };
}

function createFetchWithYtMusicAuth(cookie?: string): typeof fetch | undefined {
  if (!cookie) {
    return undefined;
  }

  return async (input, init) => {
    const originalUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = typeof init?.body === "string" ? init.body : undefined;
    const requestContext = getYtMusicRequestContext(headers, body);
    const isYtMusicRequest =
      originalUrl.includes("/youtubei/v1/") &&
      (requestContext.isYtMusicRequest ||
        originalUrl.includes("/like/") ||
        originalUrl.includes("/playlist/edit") ||
        requestContext.browseId?.startsWith("FEmusic_"));
    const isLibraryBrowse = requestContext.browseId === "FEmusic_library_landing";
    let authorizationApplied = false;
    let requestUrl = originalUrl;

    if (isYtMusicRequest) {
      const rewrittenUrl = new URL(originalUrl);
      if (rewrittenUrl.hostname === "www.youtube.com") {
        rewrittenUrl.hostname = "music.youtube.com";
        requestUrl = rewrittenUrl.toString();
      }

      headers.set("Origin", YTMUSIC_ORIGIN);
      headers.set("Referer", `${YTMUSIC_ORIGIN}/`);
      headers.set("X-Origin", YTMUSIC_ORIGIN);
      headers.set("Cookie", cookie);
      headers.set("X-Goog-Authuser", headers.get("X-Goog-Authuser") ?? "0");

      const authHeader = createSapisdHash(cookie);
      if (authHeader) {
        headers.set("Authorization", authHeader);
        authorizationApplied = true;
      }
    }

    if (isLibraryBrowse && !loggedLibraryAuthDebug) {
      loggedLibraryAuthDebug = true;
      log("ytmusic", "info", "Applying YT Music request auth", {
        clientId: requestContext.clientId || null,
        clientName: requestContext.clientName || null,
        browseId: requestContext.browseId,
        overrideApplied: isYtMusicRequest,
        authorizationApplied,
        originalUrl,
        requestUrl,
        cookiePresence: getCookiePresence(cookie),
      });
    }

    const baseInit =
      input instanceof Request
        ? {
            method: input.method,
            redirect: input.redirect,
            duplex: "duplex" in input ? (input as Request & { duplex?: "half" }).duplex : undefined,
          }
        : {};

    return fetch(requestUrl, {
      ...baseInit,
      ...init,
      body: body ?? init?.body,
      headers,
    });
  };
}

function getThumbnailUrl(item: any): string | undefined {
  if (!item) {
    return undefined;
  }

  // Handle case where it's already a wrapped results object from toTrackFromRaw
  if (Array.isArray(item.thumbnails)) {
    return item.thumbnails[item.thumbnails.length - 1]?.url;
  }

  // youtubei.js nodes often have .thumbnail as a Thumbnail object or Thumbnail[] array
  const thumbnail = item.thumbnail;
  if (thumbnail) {
    if (Array.isArray(thumbnail)) {
      return thumbnail[thumbnail.length - 1]?.url;
    }
    if (typeof thumbnail === "object" && "url" in thumbnail) {
      return thumbnail.url;
    }
    if (typeof thumbnail === "object" && Array.isArray(thumbnail.contents)) {
      return thumbnail.contents[thumbnail.contents.length - 1]?.url;
    }
  }

  const thumbnails = item.thumbnails;
  if (Array.isArray(thumbnails)) {
    return thumbnails[thumbnails.length - 1]?.url;
  }

  return undefined;
}

function getCachedTrackPicture(providerId: string, sourceUrl?: string): string | undefined {
  return getCachedArtworkUrl(providerId, sourceUrl);
}

function summarizePlaybackCandidate(format: Format) {
  return {
    itag: format.itag,
    mimeType: format.mime_type,
    hasAudio: format.has_audio,
    hasVideo: format.has_video,
    bitrate: format.average_bitrate ?? format.bitrate ?? 0,
    hasUrl: Boolean(format.url),
    hasSignatureCipher: Boolean(format.signature_cipher),
    hasCipher: Boolean(format.cipher),
  };
}

function sortPlaybackFormats(formats: Format[]): Format[] {
  return [...formats].sort((left, right) => {
    const leftAudioOnly = left.has_audio && !left.has_video ? 1 : 0;
    const rightAudioOnly = right.has_audio && !right.has_video ? 1 : 0;
    if (leftAudioOnly !== rightAudioOnly) {
      return rightAudioOnly - leftAudioOnly;
    }

    const leftDirectUrl = left.url ? 1 : 0;
    const rightDirectUrl = right.url ? 1 : 0;
    if (leftDirectUrl !== rightDirectUrl) {
      return rightDirectUrl - leftDirectUrl;
    }

    const leftNonCipher = left.signature_cipher || left.cipher ? 0 : 1;
    const rightNonCipher = right.signature_cipher || right.cipher ? 0 : 1;
    if (leftNonCipher !== rightNonCipher) {
      return rightNonCipher - leftNonCipher;
    }

    const leftBitrate = left.average_bitrate ?? left.bitrate ?? 0;
    const rightBitrate = right.average_bitrate ?? right.bitrate ?? 0;
    return rightBitrate - leftBitrate;
  });
}

function expiresAtFromStreamUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("expire") ?? parsed.searchParams.get("expires");
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
 * WEB_REMIX / WEB streams increasingly expect a Proof-of-Origin token (`pot` on googlevideo URLs).
 * Mobile/TV InnerTube clients often still return playable URLs without browser BotGuard (YouTube.js #724).
 * @see https://github.com/LuanRT/YouTube.js/issues/724
 */
const PLAYBACK_INNERTUBE_CLIENTS = [
  "ANDROID",
  "YTMUSIC_ANDROID",
  "IOS",
  "TV",
  "WEB",
  "MWEB",
  "YTMUSIC",
] as const;

type PlaybackInnertubeClient = (typeof PLAYBACK_INNERTUBE_CLIENTS)[number];

async function resolvePlaybackUrlFromFormats(
  client: Innertube,
  videoId: string,
  context: { source: string },
  innertubeClient: PlaybackInnertubeClient,
): Promise<{ url: string; loudnessDb?: number } | null> {
  const clientOpts = { client: innertubeClient };
  let streamingData: Awaited<ReturnType<typeof client.getBasicInfo>>["streaming_data"] | undefined;

  try {
    const full = await client.getInfo(videoId, clientOpts);
    streamingData = full.streaming_data;
  } catch (error) {
    log("ytmusic", "info", "getInfo failed for playback, falling back to getBasicInfo", {
      videoId,
      innerClient: innertubeClient,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!streamingData) {
    try {
      const basic = await client.getBasicInfo(videoId, clientOpts);
      streamingData = basic.streaming_data;
    } catch (error) {
      log("ytmusic", "warn", "getBasicInfo failed for playback", {
        videoId,
        innerClient: innertubeClient,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!streamingData) {
    log("ytmusic", "warn", "Playback info missing streaming data", { videoId, innerClient: innertubeClient });
    return null;
  }

  const candidateFormats = sortPlaybackFormats(
    [...streamingData.adaptive_formats, ...streamingData.formats].filter(
      (format) => format.has_audio && !format.is_type_otf,
    ),
  );

  if (candidateFormats.length === 0) {
    log("ytmusic", "warn", "No audio playback formats available", { videoId, innerClient: innertubeClient });
    return null;
  }

  const failures: string[] = [];
  for (const format of candidateFormats) {
    try {
      const url = format.url ?? (await format.decipher(client.session.player));
      if (!url) {
        failures.push(`itag:${format.itag}:empty-url`);
        continue;
      }

      return {
        url,
        loudnessDb: format.loudness_db,
      };
    } catch (error) {
      failures.push(
        `itag:${format.itag}:${error instanceof Error ? error.message : "decipher-failed"}`,
      );
    }
  }

  log("ytmusic", "warn", "Failed every playback format candidate for client", {
    videoId,
    source: context.source,
    innerClient: innertubeClient,
    candidates: candidateFormats.slice(0, 5).map(summarizePlaybackCandidate),
    failures: failures.slice(0, 5),
  });

  return null;
}

function toPlaylist(item: any): PlaylistResult | null {
  const itemAny = item as any;
  const name = itemAny.title?.toString() || itemAny.name?.toString();
  if (!name) return null;

  const id = itemAny.id || itemAny.endpoint?.payload?.browseId || itemAny.browseId;
  if (!id) return null;

  // YT Music Album IDs usually start with MPRE or OLAK
  const itemType = itemAny.item_type || (id.startsWith("MPRE") || id.startsWith("OLAK") ? "album" : "playlist");

  return {
    id: `ytmusic:${id}`,
    provider: "ytmusic",
    providerId: id,
    name: sanitizeText(name, "Unknown Playlist"),
    author: itemAny.author?.name || itemAny.subtitle?.toString() || "YouTube Music",
    picture: getThumbnailUrl(itemAny),
    type: itemType === "album" ? "album" : "playlist",
    listedItemCount: typeof itemAny.item_count === "number" ? itemAny.item_count : undefined,
    entries: [],
  };
}

function readParsedItemPlayableVideoId(item: MusicResponsiveListItem | MusicTwoRowItem): string | undefined {
  const parsed = item as unknown as Record<string, any>;
  const menuItems = parsed?.menu?.items ?? parsed?.menu?.menu_renderer?.items ?? [];
  const topLevelButtons =
    parsed?.menu?.top_level_buttons
    ?? parsed?.menu?.menu_renderer?.top_level_buttons
    ?? [];
  const subtitleRuns = parsed?.subtitle?.runs ?? [];

  const id = findFirstVideoId([
    parsed.id,
    parsed.videoId,
    parsed.video_id,
    parsed.videoId_,
    parsed.endpoint?.payload?.videoId,
    parsed.endpoint?.payload?.video_id,
    parsed.endpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    parsed.overlay?.content?.play_button?.endpoint?.payload?.videoId,
    parsed.overlay?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    parsed.thumbnail_overlay?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigation_endpoint?.payload?.videoId,
    parsed.navigation_endpoint?.watch_endpoint?.video_id,
    // Try to find it in the raw_data if it exists
    parsed.raw_data?.videoId,
    parsed.raw_data?.navigationEndpoint?.watchEndpoint?.videoId,
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    ...menuItems.map((item: any) => 
      item?.navigation_endpoint?.watch_endpoint?.video_id || 
      item?.navigation_endpoint?.watch_endpoint?.videoId ||
      item?.service_endpoint?.queue_add_endpoint?.queue_target?.video_id ||
      item?.service_endpoint?.queue_add_endpoint?.queue_target?.videoId
    ),
    ...topLevelButtons.map((item: any) => 
      item?.navigation_endpoint?.watch_endpoint?.video_id ||
      item?.navigation_endpoint?.watch_endpoint?.videoId
    ),
  ]);

  if (!id) {
    // Last ditch: check if there's an id in the raw data if available
    const raw = (item as any).raw_data;
    if (raw) {
       // Deeply search for 11-char strings that look like video IDs? No, too risky.
       // But we can check common raw paths
    }
  }

  return id;
}

function toTrack(item: MusicResponsiveListItem | MusicTwoRowItem): TrackResult | null {
  const providerId = readParsedItemPlayableVideoId(item);
  if (!providerId) {
    return null;
  }

  const itemAny = item as any;

  const title =
    itemAny.title?.toString() ||
    itemAny.name?.toString() ||
    "Unknown Track";

  const artists =
    (Array.isArray(itemAny.artists) && itemAny.artists.length > 0)
      ? itemAny.artists
          .map((artist: { name?: string }) => artist.name)
          .filter(Boolean)
          .join(", ")
      : itemAny.author?.name || itemAny.subtitle?.toString() || "Unknown Artist";

  const album =
    itemAny.album?.name ||
    (itemAny.subtitle?.toString()?.includes(" • ") ? itemAny.subtitle.toString().split(" • ")[0] : "Single");

  const durationParsed = itemAny.duration;
  const seconds = typeof durationParsed === "object" ? durationParsed?.seconds : typeof durationParsed === "number" ? durationParsed : undefined;
  const time = typeof durationParsed === "object" ? durationParsed?.text : typeof durationParsed === "string" ? durationParsed : formatDuration(seconds);

  // Extract liked status from menu items if available
  let liked = false;
  try {
    const menuItems = itemAny.menu?.items || [];
    for (const menuItem of menuItems) {
      const toggleRenderer = menuItem.as?.(YTNodes.ToggleMenuServiceItem);
      if (toggleRenderer) {
        const iconType = toggleRenderer.icon_type || toggleRenderer.default_icon_type;
        if (iconType === "FAVORITE" || iconType === "LIKE") {
          liked = toggleRenderer.is_toggled || (toggleRenderer as any).toggled;
          break;
        }
      }
    }
  } catch {
    // Fallback for raw data or other structures
    const menuItems = itemAny.menu?.items || itemAny.menu?.menu_renderer?.items || [];
    for (const m of menuItems) {
      const entry = m.menuNavigationItemRenderer || m.menuServiceItemRenderer || m.toggleMenuServiceItemRenderer;
      if (entry) {
        const iconType = entry.defaultIcon?.iconType || entry.default_icon_type || entry.icon_type;
        if (iconType === "FAVORITE" || iconType === "LIKE") {
          liked = !!(entry.isToggled || entry.is_toggled || entry.toggled);
          break;
        }
      }
    }
  }

  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title: sanitizeText(title, "Unknown Track"),
    artist: sanitizeText(artists, "Unknown Artist"),
    album: sanitizeText(album, "Single"),
    duration: seconds ?? 0,
    time: time || "—",
    genre: "YouTube Music",
    picture: getCachedTrackPicture(providerId, getThumbnailUrl(item)),
    sourceLabel: "YouTube Music",
    liked,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function loadCache(): CacheShape {
  ensureAppDataDirs();

  try {
    const raw = fs.readFileSync(YTMUSIC_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CacheShape;
    return {
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      lastSyncedAt: parsed.lastSyncedAt,
    };
  } catch {
    return { tracks: [], playlists: [] };
  }
}

function saveCache(cache: CacheShape): void {
  ensureAppDataDirs();
  fs.writeFileSync(YTMUSIC_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function upsertCachedPlaylist(playlist: PlaylistResult): void {
  const cache = loadCache();
  const playlists = cache.playlists.some((item) => item.id === playlist.id)
    ? cache.playlists.map((item) => (item.id === playlist.id ? playlist : item))
    : [...cache.playlists, playlist];

  saveCache({
    ...cache,
    playlists,
  });
}

export function clearYtMusicMetadataCache(): { success: boolean } {
  try {
    ensureAppDataDirs();
    if (fs.existsSync(YTMUSIC_CACHE_PATH)) {
      fs.unlinkSync(YTMUSIC_CACHE_PATH);
    }
    if (fs.existsSync(YTMUSIC_HOME_SNAPSHOT_PATH)) {
      fs.unlinkSync(YTMUSIC_HOME_SNAPSHOT_PATH);
    }
    clearYtMusicSearchCacheFile();
    return { success: true };
  } catch {
    return { success: false };
  }
}

function isYtMusicLibrarySyncDebugEnabled(): boolean {
  if (process.env.MUXICS_YTMUSIC_SYNC_DEBUG === "1") {
    return true;
  }
  return loadSettings().ytmusicLibrarySyncDebug === true;
}

function writeDebugJson(name: string, payload: unknown): string | null {
  ensureAppDataDirs();

  try {
    const filePath = `${YTMUSIC_DEBUG_DIR}/${name}`;
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return filePath;
  } catch (error) {
    log("ytmusic", "warn", "Failed to write YT Music debug dump", {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function createClient(cookie?: string): Promise<Innertube> {
  loggedLibraryAuthDebug = false;
  await ensurePlayerEvaluator();
  return Innertube.create({
    cookie,
    fetch: createFetchWithYtMusicAuth(cookie),
    retrieve_player: true,
    generate_session_locally: true,
  });
}

function attachCredentialPersistence(client: Innertube, createdAt?: number): void {
  client.session.on("auth", ({ credentials }) => {
    persistOAuthTokens(credentials, createdAt);
  });

  client.session.on("update-credentials", ({ credentials }) => {
    persistOAuthTokens(credentials, createdAt);
  });
}

async function restoreClientFromDisk(): Promise<Innertube | null> {
  const stored = loadStoredYtMusicSession();
  if (!stored?.auth) {
    clearStoredYtMusicSession();
    return null;
  }

  try {
    if (stored.auth.kind === "cookie") {
      const client = await createClient(stored.auth.cookie);
      cachedClient = client;
      return client;
    }

    const client = await createClient();
    attachCredentialPersistence(client, stored.createdAt);
    await client.session.signIn(stored.auth.oauth);
    cachedClient = client;
    return client;
  } catch (error) {
    log("ytmusic", "warn", "Failed to restore OAuth session", error);
    clearStoredYtMusicSession();
    cachedClient = null;
    return null;
  }
}

async function getClient(force = false): Promise<Innertube> {
  if (cachedClient && !force) {
    return cachedClient;
  }

  const restored = await restoreClientFromDisk();
  if (!restored) {
    throw new Error("No YouTube Music session is available.");
  }

  return restored;
}

async function resolveProfileName(client: Innertube): Promise<Pick<AuthStatusResult, "profileName" | "avatarUrl">> {
  try {
    const accounts = await client.account.getInfo(true);
    const selected = accounts.find((account) => account.is_selected) ?? accounts[0];

    return {
      profileName: selected?.account_name?.toString() ?? "YouTube Music",
      avatarUrl: selected?.account_photo?.[selected.account_photo.length - 1]?.url,
    };
  } catch {
    return {
      profileName: "YouTube Music",
    };
  }
}

async function buildAuthStatus(): Promise<AuthStatusResult> {
  const cache = loadCache();
  const client = cachedClient ?? await restoreClientFromDisk();

  if (!client) {
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt: cache.lastSyncedAt,
    };
    return cachedAuthStatus;
  }

  try {
    const profile = await resolveProfileName(client);
    cachedAuthStatus = {
      loggedIn: true,
      provider: "ytmusic",
      persistent: true,
      lastSyncedAt: cache.lastSyncedAt,
      ...profile,
    };
  } catch (error) {
    cachedClient = null;
    clearStoredYtMusicSession();
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt: cache.lastSyncedAt,
      error: error instanceof Error ? error.message : "Failed to initialize YouTube Music session.",
    };
  }

  return cachedAuthStatus;
}

type RawNode = Record<string, any>;

function readRunsText(runs?: Array<{ text?: string }>): string {
  return Array.isArray(runs) ? runs.map((run) => run.text ?? "").join("").trim() : "";
}

function readText(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw.simpleText === "string") return raw.simpleText.trim();
  return readRunsText(raw.runs);
}

function isLikelyVideoId(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{11}$/.test(value)
    && !/^(VL|PL|LM|MPR|FEmusic_)/.test(value);
}

function findFirstVideoId(values: unknown[]): string | undefined {
  return values.find((value): value is string => isLikelyVideoId(value));
}

function readRendererPlayableVideoId(renderer: RawNode): string | undefined {
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  const topLevelButtons = renderer?.menu?.menuRenderer?.topLevelButtons ?? [];
  const subtitleRuns =
    renderer?.subtitle?.runs
    ?? renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
    ?? [];

  return findFirstVideoId([
    renderer?.playlistItemData?.videoId,
    renderer?.navigationEndpoint?.watchEndpoint?.videoId,
    renderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    renderer?.navigationEndpoint?.browseEndpoint?.browseId,
    renderer?.navigationEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_ATV"
      ? renderer?.navigationEndpoint?.watchEndpoint?.videoId
      : undefined,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.videoId,
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    ...menuItems.map((item: any) => item?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId),
    ...menuItems.map((item: any) => item?.menuNavigationItemRenderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId),
    ...menuItems.map((item: any) => item?.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint?.queueTarget?.videoId),
    ...menuItems.map((item: any) => item?.toggleMenuServiceItemRenderer?.defaultServiceEndpoint?.queueAddEndpoint?.queueTarget?.videoId),
    ...menuItems.map((item: any) => item?.toggleMenuServiceItemRenderer?.toggledServiceEndpoint?.queueAddEndpoint?.queueTarget?.videoId),
    ...topLevelButtons.map((button: any) => button?.buttonRenderer?.navigationEndpoint?.watchEndpoint?.videoId),
    ...topLevelButtons.map((button: any) => button?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId),
  ]);
}

function readRendererPlaylistId(renderer: RawNode): string | undefined {
  return renderer?.navigationEndpoint?.browseEndpoint?.browseId
    ?? renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.videoId
    ?? renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.videoId;
}

function toTrackFromRaw(renderer: RawNode): TrackResult | null {
  const providerId = readRendererPlayableVideoId(renderer);
  if (!providerId) {
    return null;
  }

  const title =
    readText(renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
    readText(renderer.title) ||
    "Unknown Track";

  const detailRuns =
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
    ?? renderer.subtitle?.runs
    ?? [];

  const artists = detailRuns
    .filter((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("UC"))
    .map((run: any) => run.text)
    .join(", ");

  const albumRun = detailRuns.find((run: any) => run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("MPR"));
  const durationText =
    detailRuns.find((run: any) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(run?.text ?? ""))?.text
    ?? readText(renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);

  let liked = false;
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  for (const m of menuItems) {
    const entry = m.toggleMenuServiceItemRenderer;
    if (entry?.defaultIcon?.iconType === "FAVORITE" || entry?.default_icon_type === "FAVORITE") {
      liked = !!(entry.isToggled || entry.is_toggled);
      break;
    }
  }

  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title: sanitizeText(title, "Unknown Track"),
    artist: sanitizeText(artists || readText(renderer.subtitle), "Unknown Artist"),
    album: sanitizeText(albumRun?.text ?? "Single", "Single"),
    duration: readDurationSeconds(durationText),
    time: durationText || formatDuration(readDurationSeconds(durationText)),
    genre: "YouTube Music",
    picture: getCachedTrackPicture(providerId, getThumbnailUrl({
      thumbnails: renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
    })),
    sourceLabel: "YouTube Music",
    liked,
  };
}

function summarizeFailedTrackRenderer(renderer: RawNode) {
  return {
    title: readText(renderer?.title) || readText(renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || null,
    navigationEndpoint: renderer?.navigationEndpoint ?? null,
    thumbnailOverlay: renderer?.thumbnailOverlay ?? null,
    menuItems: (renderer?.menu?.menuRenderer?.items ?? []).slice(0, 2),
    topLevelButtons: (renderer?.menu?.menuRenderer?.topLevelButtons ?? []).slice(0, 2),
  };
}

function readNestedBrowseEndpoint(node: RawNode): RawNode | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.browseEndpoint && typeof node.browseEndpoint === "object") {
    return node.browseEndpoint;
  }

  const persistCommand = node.musicLibraryPersistLaunchNavigationCommand?.command;
  if (persistCommand) {
    const nestedPersistEndpoint = readNestedBrowseEndpoint(persistCommand);
    if (nestedPersistEndpoint) {
      return nestedPersistEndpoint;
    }
  }

  const commandExecutorCommands = node.commandExecutorCommand?.commands;
  if (Array.isArray(commandExecutorCommands)) {
    for (const command of commandExecutorCommands) {
      const nestedCommandEndpoint = readNestedBrowseEndpoint(command);
      if (nestedCommandEndpoint) {
        return nestedCommandEndpoint;
      }
    }
  }

  const nestedCandidates = [
    node.navigationEndpoint,
    node.onSelectCommand,
    node.serviceEndpoint,
    node.command,
  ];

  for (const candidate of nestedCandidates) {
    const nestedEndpoint = readNestedBrowseEndpoint(candidate);
    if (nestedEndpoint) {
      return nestedEndpoint;
    }
  }

  return null;
}

function readChipBrowseEndpoint(chip: RawNode | undefined | null): RawNode | null {
  if (!chip) {
    return null;
  }
  return readNestedBrowseEndpoint(chip);
}

function parsePlaylistListedCountFromRenderer(renderer: RawNode): number | undefined {
  const text = readText(renderer.subtitle);
  const m = text.match(/([\d,]+)\s*(?:songs?|tracks?)/i);
  if (!m) {
    return undefined;
  }
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

function toPlaylistFromRaw(renderer: RawNode): PlaylistResult | null {
  const providerId = readRendererPlaylistId(renderer);
  if (!providerId || (!providerId.startsWith("VL") && !providerId.startsWith("PL") && !providerId.startsWith("LM"))) {
    return null;
  }

  const name = readText(renderer.title) || readText(renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || "Playlist";
  return {
    id: `ytmusic-playlist:${providerId.replace(/^VL/, "")}`,
    provider: "ytmusic",
    providerId: providerId.replace(/^VL/, ""),
    name,
    editable: true,
    entries: [],
    listedItemCount: parsePlaylistListedCountFromRenderer(renderer),
  };
}

function mergePlaylistSummaryWithCachedDetail(
  summary: PlaylistResult,
  cached: PlaylistResult | undefined,
): PlaylistResult {
  if (!cached) {
    return summary;
  }

  const cachedEntries =
    cached.entries.length > 0
      ? cached.entries
      : cached.tracks && cached.tracks.length > 0
        ? toPlaylistEntries(cached.tracks)
        : [];

  const hasTrackDetail = cachedEntries.length > 0;
  const hasHint = typeof cached.listedItemCount === "number" && cached.listedItemCount > 0;

  if (!hasTrackDetail && !hasHint) {
    return summary;
  }

  return {
    ...summary,
    entries: hasTrackDetail ? cachedEntries : summary.entries,
    tracks: cached.tracks?.length ? cached.tracks : summary.tracks,
    listedItemCount: cached.listedItemCount ?? summary.listedItemCount,
  };
}

function toPlaylistEntries(tracks: TrackResult[]) {
  return tracks.map((track) => ({
    id: track.id,
    provider: track.provider,
    providerId: track.providerId,
    title: track.title,
  }));
}

async function getYtMusicPlaylistFromRaw(client: Innertube, playlistId: string): Promise<PlaylistResult | null> {
  const raw = await client.actions.execute("/browse", {
    browseId: playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`,
    client: "YTMUSIC",
  });
  const payload = raw.data;
  const renderers = [
    ...collectRenderers(payload, "musicResponsiveListItemRenderer"),
    ...collectRenderers(payload, "musicTwoRowItemRenderer"),
    ...collectCandidateMusicNodes(payload),
  ];
  const tracks = uniqueById(
    renderers
      .map((renderer) => toTrackFromRaw(renderer))
      .filter((track): track is TrackResult => track != null),
  );

  if (tracks.length === 0) {
    return null;
  }

  const headerTitle =
    readText(payload?.header?.musicDetailHeaderRenderer?.title) ||
    readText(payload?.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicDetailHeaderRenderer?.title) ||
    readText(payload?.header?.musicResponsiveHeaderRenderer?.title) ||
    "Playlist";

  return {
    id: `ytmusic-playlist:${playlistId}`,
    provider: "ytmusic",
    providerId: playlistId,
    name: headerTitle,
    editable: true,
    entries: toPlaylistEntries(tracks),
    tracks,
    listedItemCount: tracks.length,
  };
}

async function collectPlaylistItems(playlist: Awaited<ReturnType<Innertube["music"]["getPlaylist"]>>) {
  const items = [...playlist.items];
  let current = playlist;

  while (current.has_continuation) {
    current = await current.getContinuation();
    items.push(...current.items);
  }

  return uniqueById(
    items
      .map((item) => toTrack(item as MusicResponsiveListItem | MusicTwoRowItem))
      .filter((item): item is TrackResult => item != null),
  );
}

function collectRenderers(node: any, key: string, results: RawNode[] = []): RawNode[] {
  if (!node || typeof node !== "object") {
    return results;
  }

  if (key in node && node[key] && typeof node[key] === "object") {
    results.push(node[key]);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectRenderers(item, key, results);
    }
    return results;
  }

  for (const value of Object.values(node)) {
    collectRenderers(value, key, results);
  }

  return results;
}

function collectCandidateMusicNodes(node: any, results: RawNode[] = []): RawNode[] {
  if (!node || typeof node !== "object") {
    return results;
  }

  if (
    Array.isArray(node?.flexColumns) ||
    Array.isArray(node?.runs) ||
    node?.playlistItemData?.videoId ||
    node?.musicItemThumbnailOverlayRenderer ||
    node?.musicPlayButtonRenderer
  ) {
    results.push(node);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectCandidateMusicNodes(item, results);
    }
    return results;
  }

  for (const value of Object.values(node)) {
    collectCandidateMusicNodes(value, results);
  }

  return results;
}

function collectRendererKeyCounts(node: any, counts = new Map<string, number>()): Map<string, number> {
  if (!node || typeof node !== "object") {
    return counts;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectRendererKeyCounts(item, counts);
    }
    return counts;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith("Renderer")) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    collectRendererKeyCounts(value, counts);
  }

  return counts;
}

function getTopRendererKeys(node: any, limit = 20): Array<[string, number]> {
  return [...collectRendererKeyCounts(node).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function getLibraryMessageSummary(node: any) {
  const message = collectRenderers(node, "messageRenderer")[0];
  const subtext = collectRenderers(node, "messageSubtextRenderer")[0];
  const button = collectRenderers(node, "buttonRenderer")[0];

  return {
    message: message ? readText(message.text) : "",
    subtext: subtext ? readText(subtext.text) : "",
    button: button ? readText(button.text) : "",
  };
}

function classifyLibraryAuthState(node: any): LibraryAuthState {
  const summary = getLibraryMessageSummary(node);
  const normalizedMessage = `${summary.message} ${summary.subtext} ${summary.button}`.toLowerCase();
  const signedOut =
    normalizedMessage.includes("sign in") ||
    normalizedMessage.includes("access tracks that you liked or saved") ||
    normalizedMessage.includes("explore your favorites");

  if (signedOut) {
    return {
      authenticated: false,
      message: "Imported browser session is not being accepted by YouTube Music. Please reload the extension from a logged-in music.youtube.com tab and retry.",
    };
  }

  return { authenticated: true };
}

async function getLibraryPageData(client: Innertube, filter?: string): Promise<any> {
  if (!filter) {
    const response = await client.actions.execute("/browse", {
      browseId: "FEmusic_library_landing",
      client: "YTMUSIC",
    });
    return response.data;
  }

  const base = await getLibraryPageData(client);
  const chipRenderers = collectRenderers(base, "chipCloudChipRenderer");
  const chip = chipRenderers.find((entry) => readText(entry.text) === filter);
  const endpoint = readChipBrowseEndpoint(chip);
  if (!endpoint) {
    return base;
  }

  const response = await client.actions.execute("/browse", {
    client: "YTMUSIC",
    ...(endpoint.browseId ? { browseId: endpoint.browseId } : {}),
    ...(endpoint.params ? { params: endpoint.params } : {}),
    ...(endpoint.continuation ? { continuation: endpoint.continuation } : {}),
  });
  return response.data;
}

async function validateCookieClient(cookie: string): Promise<Innertube> {
  const client = await createClient(cookie);
  const libraryPage = await getLibraryPageData(client);
  const authState = classifyLibraryAuthState(libraryPage);

  if (!authState.authenticated) {
    throw new Error(authState.message);
  }

  return client;
}

export async function getYtMusicAuthStatus(): Promise<AuthStatusResult> {
  return buildAuthStatus();
}

export async function loginToYtMusic(): Promise<AuthLoginStartResult> {
  // Embedded OAuth/sign-in windows are disabled; any future BrowserWindow flow must
  // call loadURL only after `!win.isDestroyed()` to avoid "Object has been destroyed".
  return {
    kind: "error",
    message: "Automatic sign-in is unavailable for YouTube Music. Import your browser cookies instead.",
  };
}

export async function completeYtMusicLogin(): Promise<AuthLoginCompleteResult> {
  if (!pendingLogin) {
    const auth = await buildAuthStatus();
    return auth.loggedIn
      ? { kind: "completed", auth }
      : { kind: "error", message: "No YouTube Music sign-in is in progress." };
  }

  return pendingLogin.completion;
}

export function cancelYtMusicLogin(): { success: boolean } {
  if (!pendingLogin) {
    return { success: false };
  }

  pendingLogin.canceled = true;
  pendingLogin = null;
  cachedClient = null;

  return { success: true };
}

function normalizeCookieString(cookie: string): string {
  return cookie
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/\r?\n/g, "; ")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("; ");
}

export async function importYtMusicSession(
  cookie: string,
  details?: ImportedSessionDetails,
): Promise<ImportYtMusicSessionResult> {
  const normalizedCookie = normalizeCookieString(cookie);
  if (!normalizedCookie) {
    return {
      success: false,
      error: "Paste a valid Cookie header from a logged-in music.youtube.com session.",
    };
  }

  const cookiePresence = getCookiePresence(normalizedCookie);
  const reportedCookieNames = details?.cookieNames ?? [];
  const hasImportedAuthCookie = hasRequiredAuthCookie(normalizedCookie);
  if (!hasImportedAuthCookie) {
    log("ytmusic", "warn", "Rejected imported browser session without auth cookies", {
      sourceUrl: details?.sourceUrl ?? null,
      reportedCookieNames,
      cookiePresence,
    });
    return {
      success: false,
      error: "The imported browser session is missing the YouTube Music auth cookies required for sign-in. Open music.youtube.com in the same browser profile, make sure you're logged in, and try again.",
    };
  }

  try {
    const client = await validateCookieClient(normalizedCookie);
    if (!persistCookieString(normalizedCookie)) {
      return {
        success: false,
        error: "Could not securely store the YouTube Music session on this machine.",
      };
    }

    pendingLogin = null;
    cachedClient = client;
    loggedLibraryAuthDebug = false;
    bumpYtMusicSearchCacheSession();
    const auth = await buildAuthStatus();
    return { success: auth.loggedIn, auth, error: auth.loggedIn ? undefined : auth.error };
  } catch (error) {
    cachedClient = null;
    clearStoredYtMusicSession();
    loggedLibraryAuthDebug = false;
    log("ytmusic", "warn", "Imported browser session was rejected", {
      sourceUrl: details?.sourceUrl ?? null,
      reportedCookieNames,
      cookiePresence,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to validate the YouTube Music cookies.",
    };
  }
}

export function saveYtMusicCookieSession(
  cookie: string,
  details?: ImportedSessionDetails,
): { success: boolean; error?: string } {
  const normalizedCookie = normalizeCookieString(cookie);
  if (!normalizedCookie) {
    return {
      success: false,
      error: "Paste a valid Cookie header from a logged-in music.youtube.com session.",
    };
  }

  if (!hasRequiredAuthCookie(normalizedCookie)) {
    log("ytmusic", "warn", "Bridge sent browser session without auth cookies", {
      sourceUrl: details?.sourceUrl ?? null,
      reportedCookieNames: details?.cookieNames ?? [],
      cookiePresence: getCookiePresence(normalizedCookie),
    });
    return {
      success: false,
      error: "The imported browser session is missing the required YouTube Music auth cookies.",
    };
  }

  if (!persistCookieString(normalizedCookie)) {
    return {
      success: false,
      error: "Could not securely store the YouTube Music session on this machine.",
    };
  }

  pendingLogin = null;
  cachedClient = null;
  cachedAuthStatus = null;
  loggedLibraryAuthDebug = false;
  bumpYtMusicSearchCacheSession();
  return { success: true };
}

export async function logoutFromYtMusic(): Promise<AuthStatusResult> {
  pendingLogin = null;
  cachedClient = null;
  loggedLibraryAuthDebug = false;
  bumpYtMusicSearchCacheSession();
  clearStoredYtMusicSession();
  cachedAuthStatus = {
    loggedIn: false,
    provider: "ytmusic",
    persistent: false,
    lastSyncedAt: loadCache().lastSyncedAt,
  };
  return cachedAuthStatus;
}

export async function syncYtMusicLibrary(): Promise<YTMusicLibrarySyncResult> {
  const client = await getClient();
  const existingCache = loadCache();
  const cachedPlaylists = new Map(existingCache.playlists.map((playlist) => [playlist.id, playlist]));
  const libraryPage = await getLibraryPageData(client);
  const libraryAuthState = classifyLibraryAuthState(libraryPage);
  if (!libraryAuthState.authenticated) {
    const storedSession = loadStoredYtMusicSession();
    log("ytmusic", "warn", "Library sync rejected by YouTube Music", {
      cookiePresence: getCookiePresence(storedSession?.auth.kind === "cookie" ? storedSession.auth.cookie : undefined),
      libraryMessage: getLibraryMessageSummary(libraryPage),
    });
    throw new Error(libraryAuthState.message);
  }

  const availableFilters = collectRenderers(libraryPage, "chipCloudChipRenderer").map((entry) => readText(entry.text));
  const tracksPage = availableFilters.includes("Songs") ? await getLibraryPageData(client, "Songs") : libraryPage;
  const playlistPage = availableFilters.includes("Playlists") ? await getLibraryPageData(client, "Playlists") : libraryPage;
  const debugSync = isYtMusicLibrarySyncDebugEnabled();
  const rawDumpPaths = debugSync
    ? {
        library: writeDebugJson("library-landing.json", libraryPage),
        tracks: writeDebugJson("library-songs.json", tracksPage),
        playlists: writeDebugJson("library-playlists.json", playlistPage),
      }
    : { library: null, tracks: null, playlists: null };
  const trackAuthState = classifyLibraryAuthState(tracksPage);
  if (!trackAuthState.authenticated) {
    throw new Error(trackAuthState.message);
  }
  const playlistAuthState = classifyLibraryAuthState(playlistPage);
  if (!playlistAuthState.authenticated) {
    throw new Error(playlistAuthState.message);
  }
  const trackRenderers = [
    ...collectRenderers(tracksPage, "musicResponsiveListItemRenderer"),
    ...collectRenderers(tracksPage, "musicTwoRowItemRenderer"),
    ...collectCandidateMusicNodes(tracksPage),
  ];
  const playlistRenderers = [
    ...collectRenderers(playlistPage, "musicResponsiveListItemRenderer"),
    ...collectRenderers(playlistPage, "musicTwoRowItemRenderer"),
    ...collectCandidateMusicNodes(playlistPage),
  ];

  const tracks = uniqueById(
    trackRenderers
      .map((item) => toTrackFromRaw(item))
      .filter((item): item is TrackResult => item != null),
  );

  const playlistSummaries = uniqueById(
    playlistRenderers
      .map((item) => toPlaylistFromRaw(item))
      .filter((item): item is PlaylistResult => item != null),
  );

  const failedTrackCandidates = tracks.length === 0
    ? trackRenderers
      .filter((renderer) => renderer?.title || renderer?.flexColumns?.[0] || renderer?.navigationEndpoint || renderer?.menu)
      .filter((renderer) => !readRendererPlayableVideoId(renderer))
      .slice(0, 2)
      .map((renderer) => summarizeFailedTrackRenderer(renderer))
    : [];

  if (debugSync) {
    log("ytmusic", "info", "Library extraction stats", {
      availableFilters,
      trackRendererCount: trackRenderers.length,
      playlistRendererCount: playlistRenderers.length,
      extractedTracks: tracks.length,
      extractedPlaylists: playlistSummaries.length,
      sampleTrackKeys: trackRenderers[0] ? Object.keys(trackRenderers[0]).slice(0, 10) : [],
      samplePlaylistKeys: playlistRenderers[0] ? Object.keys(playlistRenderers[0]).slice(0, 10) : [],
      topTrackRenderers: getTopRendererKeys(tracksPage, 15),
      topPlaylistRenderers: getTopRendererKeys(playlistPage, 15),
      trackMessage: getLibraryMessageSummary(tracksPage),
      playlistMessage: getLibraryMessageSummary(playlistPage),
      trackFilterEndpointKeys: availableFilters.includes("Songs")
        ? Object.keys(readChipBrowseEndpoint(collectRenderers(libraryPage, "chipCloudChipRenderer").find((entry) => readText(entry.text) === "Songs")) ?? {})
        : [],
      failedTrackCandidates,
      rawDumpPaths,
    });
  }

  const playlists = playlistSummaries.map((playlist) =>
    mergePlaylistSummaryWithCachedDetail(playlist, cachedPlaylists.get(playlist.id)),
  );

  const lastSyncedAt = Date.now();
  saveCache({ tracks, playlists, lastSyncedAt });

  cachedAuthStatus = cachedAuthStatus
    ? { ...cachedAuthStatus, lastSyncedAt, loggedIn: true }
    : {
        loggedIn: true,
        provider: "ytmusic",
        persistent: true,
        lastSyncedAt,
      };

  log("ytmusic", "info", "Library sync complete", {
    tracks: tracks.length,
    playlists: playlists.length,
  });

  if (loadSettings().ytmusicHomeSnapshotEnabled !== false) {
    void getYtMusicHome().catch(() => undefined);
  }

  return { tracks, playlists, lastSyncedAt };
}

export async function getYtMusicHome(): Promise<YTMusicHomeResult> {
  const result = await getYtMusicHomeFeed();
  const allTracks = result.sections.flatMap((s) => s.items.filter((i): i is TrackResult => "provider" in i && i.provider === "ytmusic"));
  return {
    tracks: uniqueById(allTracks).slice(0, 25),
  };
}

export async function getYtMusicHomeFeed(): Promise<YTMusicHomeFeedResult> {
  const client = await getClient();
  const homeFeed = await client.music.getHomeFeed();
  const sections: YTMusicHomeSectionResult[] = [];

  const rawSections = homeFeed.sections || [];
  log("ytmusic", "info", `Parsing home feed with ${rawSections.length} raw sections`);

  for (const section of rawSections) {
    try {
      log("ytmusic", "info", `Section type: ${section.type}`);
      let title = "";
      let shelfContents: any[] = [];

      if (section.type === "MusicCarouselShelf") {
        const shelf = section.as(YTNodes.MusicCarouselShelf);
        title = shelf.header?.title?.toString() || "Recommended";
        shelfContents = shelf.contents || [];
      } else if (section.type === "MusicShelf") {
        const shelf = section.as(YTNodes.MusicShelf);
        title = shelf.title?.toString() || "Recommended";
        shelfContents = shelf.contents || [];
      } else if (section.type === "MusicResponsiveListItemShelf") {
        // Broaden to other shelf types if they exist in future versions
        const shelf = section as any;
        title = shelf.header?.title?.toString() || shelf.title?.toString() || "Recommended";
        shelfContents = shelf.contents || [];
      } else {
        continue;
      }

      log("ytmusic", "info", `Processing shelf: ${title} with ${shelfContents.length} items`);

      const items: (TrackResult | PlaylistResult)[] = [];
      for (const rawItem of shelfContents) {
        const track = toTrack(rawItem);
        if (track) {
          items.push(track);
          log("ytmusic", "info", `Parsed track in ${title}: ${track.title} [${track.providerId}]`);
        } else {
          const playlist = toPlaylist(rawItem);
          if (playlist) {
            items.push(playlist);
            log("ytmusic", "info", `Parsed playlist in ${title}: ${playlist.name} [${playlist.providerId}]`);
          } else {
            const itemAny = rawItem as any;
            log("ytmusic", "info", `Rejected item in ${title}: ${itemAny.type}`, {
              id: itemAny.id,
              keys: Object.keys(itemAny),
              item_type: itemAny.item_type,
              hasEndpoint: !!itemAny.endpoint,
              endpointType: itemAny.endpoint?.type,
              hasNavEndpoint: !!itemAny.navigationEndpoint,
              hasRawData: !!itemAny.raw_data
            });
          }
        }
      }

      if (items.length > 0) {
        sections.push({ title, items });
      }
    } catch (err) {
      log("ytmusic", "warn", "Failed to parse home feed section", err);
    }
  }

  log("ytmusic", "info", `Returning home feed with ${sections.length} sections`);
  return { sections };
}

export async function searchYtMusic(query: string): Promise<TrackResult[]> {
  const client = await getClient();
  const results = await client.music.search(query, { type: "song" });
  const songs = results.songs?.contents ?? [];

  return uniqueById(
    songs.map((item) => toTrack(item)).filter((item): item is TrackResult => item != null),
  );
}

export async function getYtMusicPlaylist(playlistId: string): Promise<PlaylistResult | null> {
  const client = await getClient();
  try {
    const playlist = await client.music.getPlaylist(playlistId);
    const tracks = await collectPlaylistItems(playlist);

    if (tracks.length === 0) {
      throw new Error("Parsed playlist did not include any playable tracks.");
    }

    const header = playlist.header;
    const name =
      ("title" in (header ?? {}) && (header as any).title?.toString?.()) ||
      ("name" in (header ?? {}) && (header as any).name?.toString?.()) ||
      "Playlist";

    const detailed = {
      id: `ytmusic-playlist:${playlistId}`,
      provider: "ytmusic" as const,
      providerId: playlistId,
      name,
      editable: true,
      entries: toPlaylistEntries(tracks),
      tracks,
      listedItemCount: tracks.length,
    };

    upsertCachedPlaylist(detailed);
    return detailed;
  } catch (error) {
    log("ytmusic", "warn", "Parsed playlist fetch failed, falling back to raw extraction", {
      playlistId,
      error: error instanceof Error ? error.message : String(error),
    });

    const detailed = await getYtMusicPlaylistFromRaw(client, playlistId);
    if (detailed) {
      upsertCachedPlaylist(detailed);
    }
    return detailed;
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
  const source = "ytmusic";

  try {
    const client = await getClient();

    for (const innerClient of PLAYBACK_INNERTUBE_CLIENTS) {
      try {
        const format = await client.getStreamingData(videoId, {
          type: "audio",
          quality: "best",
          client: innerClient,
        });
        if (format.url) {
          log("ytmusic", "info", "Playback URL via getStreamingData", {
            videoId,
            innerClient,
            itag: format.itag,
          });
          return { url: format.url, loudnessDb: format.loudness_db };
        }
      } catch (error) {
        log("ytmusic", "info", "getStreamingData failed for client", {
          videoId,
          innerClient,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const innerClient of PLAYBACK_INNERTUBE_CLIENTS) {
      const resolved = await resolvePlaybackUrlFromFormats(client, videoId, { source }, innerClient);
      if (resolved) {
        log("ytmusic", "info", "Playback URL via format scan", { videoId, innerClient });
        return resolved;
      }
    }

    return null;
  } catch (error) {
    log("ytmusic", "warn", "resolveYtMusicDirectStream failed", {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getYtMusicPlayback(trackId: string, providerId: string): Promise<TrackPlaybackResult> {
  const videoId = providerId || trackId.replace(/^ytmusic:/, "");
  const fallbackExpiresAt = () => Date.now() + 1000 * 60 * 20;

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
    const resolved = await resolveYtMusicDirectStream(videoId);
    if (resolved?.url) {
      return {
        mode: "direct",
        targetId: videoId,
        url: getCachedAudioUrl(videoId, resolved.url),
        expiresAt: expiresAtFromStreamUrl(resolved.url) ?? fallbackExpiresAt(),
        loudnessDb: resolved.loudnessDb,
      };
    }

    log("ytmusic", "info", "Innertube playback had no usable URL", { videoId });
  } catch (error) {
    log("ytmusic", "warn", "Innertube playback resolution failed", {
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

export async function likeYtMusicTrack(videoId: string): Promise<{ success: boolean }> {
  const client = await getClient();
  // Using actions.execute directly with target as an object.
  // The error "Invalid value at 'target' ... \"qFTo8PUBoQ0\"" suggests that the API
  // expected an object but got a string. We wrap it explicitly.
  await client.actions.execute("/like/like", {
    target: { videoId },
  });
  return { success: true };
}

export async function unlikeYtMusicTrack(videoId: string): Promise<{ success: boolean }> {
  const client = await getClient();
  await client.actions.execute("/like/removerating", {
    target: { videoId },
  });
  return { success: true };
}

export async function createYtMusicPlaylist(name: string, trackProviderIds: string[] = []) {
  const client = await getClient();
  const response = await client.playlist.create(name, trackProviderIds);
  return {
    success: !!response.success,
    playlistId: response.playlist_id,
  };
}

export async function renameYtMusicPlaylist(playlistId: string, name: string) {
  const client = await getClient();
  await client.playlist.setName(playlistId, name);
  return { success: true };
}

export async function deleteYtMusicPlaylist(playlistId: string) {
  const client = await getClient();
  await client.playlist.delete(playlistId);
  return { success: true };
}

export async function addTrackToYtMusicPlaylist(playlistId: string, videoId: string) {
  const client = await getClient();
  await client.playlist.addVideos(playlistId, [videoId]);
  return { success: true };
}

export async function removeTrackFromYtMusicPlaylist(playlistId: string, videoId: string) {
  const client = await getClient();
  await client.playlist.removeVideos(playlistId, [videoId]);
  return { success: true };
}

export function getCachedYtMusicLibrary(): CacheShape {
  return loadCache();
}
