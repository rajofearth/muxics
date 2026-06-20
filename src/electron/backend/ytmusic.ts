import fs from "node:fs";
import crypto from "node:crypto";
import { Innertube, YTNodes } from "youtubei.js";

type MusicResponsiveListItem = InstanceType<
  typeof YTNodes.MusicResponsiveListItem
>;
type MusicTwoRowItem = InstanceType<typeof YTNodes.MusicTwoRowItem>;
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
import {
  ensureAppDataDirs,
  YTMUSIC_CACHE_PATH,
  YTMUSIC_DEBUG_DIR,
  YTMUSIC_HOME_SNAPSHOT_PATH,
} from "./paths";
import {
  bumpYtMusicSearchCacheSession,
  clearYtMusicSearchCacheFile,
} from "./ytmusicSearchCache";
import { log } from "./logger";
import { getYtDlpStreamUrl } from "./ytdlp";
import {
  getCachedArtworkUrl,
  getCachedAudioUrl,
  getAudioCacheKey,
  getAudioPathByKey,
} from "./ytMusicCache";
import { getAudioServerPort } from "./audioServer";
import {
  clearStoredYtMusicSession,
  loadStoredYtMusicSession,
  persistCookieString,
  persistOAuthTokens,
} from "./ytmusicSession";
import {
  formatDuration,
  readDurationSeconds,
  sanitizeText,
} from "./ytmusicStrings";

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

/**
 * Returns the YouTube Music session cookie from the cached Innertube client.
 * Used by the audio server proxy and cache warm paths to pass auth context
 * to googlevideo CDN requests that would otherwise return 403.
 */
export function getYtMusicSessionCookie(): string | undefined {
  return cachedClient?.session.cookie;
}
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

function getCookieValue(
  cookie: string | undefined,
  name: string,
): string | undefined {
  if (!cookie) {
    return undefined;
  }

  const part = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return part ? part.slice(name.length + 1) : undefined;
}

export function createSapisdHash(cookie: string): string | null {
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

function getCookiePresence(
  cookie: string | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    DIAGNOSTIC_COOKIE_NAMES.map((name) => [
      name,
      Boolean(getCookieValue(cookie, name)),
    ]),
  );
}

function hasRequiredAuthCookie(cookie: string | undefined): boolean {
  return REQUIRED_COOKIE_NAMES.some((name) =>
    Boolean(getCookieValue(cookie, name)),
  );
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
    isYtMusicRequest:
      clientId === YTMUSIC_CLIENT_ID || clientName === YTMUSIC_CLIENT_NAME,
  };
}

function createFetchWithYtMusicAuth(cookie?: string): typeof fetch | undefined {
  if (!cookie) {
    return undefined;
  }

  return async (input, init) => {
    const originalUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const body = typeof init?.body === "string" ? init.body : undefined;
    const requestContext = getYtMusicRequestContext(headers, body);
    const isYtMusicRequest =
      originalUrl.includes("/youtubei/v1/") &&
      (requestContext.isYtMusicRequest ||
        originalUrl.includes("/like/") ||
        originalUrl.includes("/playlist/edit") ||
        requestContext.browseId?.startsWith("FEmusic_"));
    const isLibraryBrowse =
      requestContext.browseId === "FEmusic_library_landing";
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
            duplex:
              "duplex" in input
                ? (input as Request & { duplex?: "half" }).duplex
                : undefined,
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
  // or has a direct thumbnails array (parsed youtubei.js nodes)
  if (Array.isArray(item.thumbnails)) {
    return item.thumbnails[item.thumbnails.length - 1]?.url;
  }

  // Helper: extract the last URL from a thumbnails array
  const pickLastThumbnailUrl = (
    thumbs: { url?: string }[] | undefined,
  ): string | undefined => thumbs?.[thumbs.length - 1]?.url;

  // Helper: drill into a thumbnail object (raw API structures)
  const resolveThumbnailRenderer = (obj: any): string | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    // Direct .thumbnails on the object itself (most common raw API pattern)
    if (Array.isArray(obj.thumbnails))
      return pickLastThumbnailUrl(obj.thumbnails);
    // Direct .thumbnail.thumbnails
    const direct = obj.thumbnail;
    if (direct && Array.isArray(direct.thumbnails))
      return pickLastThumbnailUrl(direct.thumbnails);
    // musicThumbnailRenderer wrapper
    const renderer = obj.musicThumbnailRenderer;
    if (renderer?.thumbnail && Array.isArray(renderer.thumbnail.thumbnails))
      return pickLastThumbnailUrl(renderer.thumbnail.thumbnails);
    return undefined;
  };

  // youtubei.js nodes often have .thumbnail as a Thumbnail object or Thumbnail[] array
  const thumbnail = item.thumbnail;
  if (thumbnail) {
    if (Array.isArray(thumbnail)) {
      return pickLastThumbnailUrl(thumbnail);
    }
    if (typeof thumbnail === "object" && "url" in thumbnail) {
      return thumbnail.url;
    }
    if (typeof thumbnail === "object" && Array.isArray(thumbnail.contents)) {
      return pickLastThumbnailUrl(thumbnail.contents);
    }
    // Try nested thumbnail renderer structures (raw YouTube API responses)
    if (typeof thumbnail === "object") {
      const result = resolveThumbnailRenderer(thumbnail);
      if (result) return result;
    }
  }

  // Try thumbnailRenderer sibling (alternative raw API structure)
  const thumbRenderer = item.thumbnailRenderer;
  if (thumbRenderer) {
    const result = resolveThumbnailRenderer(thumbRenderer);
    if (result) return result;
  }

  // Try item-level thumbnail renderer (some raw nodes have this at root)
  const musicRenderer = item.musicThumbnailRenderer;
  if (
    musicRenderer?.thumbnail &&
    Array.isArray(musicRenderer.thumbnail.thumbnails)
  ) {
    return pickLastThumbnailUrl(musicRenderer.thumbnail.thumbnails);
  }

  const thumbnails = item.thumbnails;
  if (Array.isArray(thumbnails)) {
    return pickLastThumbnailUrl(thumbnails);
  }

  return undefined;
}

function getCachedTrackPicture(
  providerId: string,
  sourceUrl?: string,
): string | undefined {
  return getCachedArtworkUrl(providerId, sourceUrl);
}

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

function toPlaylist(item: any): PlaylistResult | null {
  const itemAny = item as any;
  const name = itemAny.title?.toString() || itemAny.name?.toString();
  if (!name) return null;

  if (
    itemAny.item_type === "artist" ||
    itemAny.item_type === "library_artist"
  ) {
    return null;
  }

  const id =
    readBrowseIdFromYtmusicSearchItem(itemAny) ||
    itemAny.endpoint?.payload?.browseEndpoint?.browseId ||
    itemAny.id ||
    itemAny.endpoint?.payload?.browseId ||
    itemAny.browseId;
  if (!id || !isPlausibleYtMusicPlaylistOrAlbumId(id)) {
    return null;
  }

  // YT Music Album IDs usually start with MPRE or OLAK
  const isAlbum =
    id.startsWith("MPRE") ||
    id.startsWith("OLAK") ||
    itemAny.item_type === "album";
  const itemType = isAlbum ? "album" : "playlist";

  return {
    id: `ytmusic:${id}`,
    provider: "ytmusic",
    providerId: id,
    name: sanitizeText(name, "Unknown Playlist"),
    author:
      itemAny.author?.name || itemAny.subtitle?.toString() || "YouTube Music",
    picture: getThumbnailUrl(itemAny),
    type: itemType,
    listedItemCount:
      typeof itemAny.item_count === "number" ? itemAny.item_count : undefined,
    entries: [],
    // Home feed items (Mixes, Albums) should generally not show edit/delete icons
    editable: false,
  };
}

function collectWatchVideoIdsFromParsedFlexColumns(
  item: Record<string, any>,
): string[] {
  const cols = item.flex_columns;
  if (!Array.isArray(cols)) {
    return [];
  }
  const out: string[] = [];
  for (const col of cols) {
    const runs = col?.title?.runs ?? [];
    for (const run of runs) {
      const ep = run?.endpoint ?? run?.navigationEndpoint;
      const vid = ep?.payload?.videoId ?? ep?.payload?.watchEndpoint?.videoId;
      if (typeof vid === "string") {
        out.push(vid);
      }
    }
  }
  return out;
}

function readParsedItemPlayableVideoId(
  item: MusicResponsiveListItem | MusicTwoRowItem,
): string | undefined {
  const parsed = item as unknown as Record<string, any>;

  const menuItems =
    parsed?.menu?.items ?? parsed?.menu?.menu_renderer?.items ?? [];
  const topLevelButtons =
    parsed?.menu?.top_level_buttons ??
    parsed?.menu?.menu_renderer?.top_level_buttons ??
    [];
  const subtitleRuns = parsed?.subtitle?.runs ?? [];

  // Try direct properties first (fast path for common cases)
  const directId = findFirstVideoId([
    parsed.id,
    // Strip VL prefix from watch playlist IDs (e.g. "VLaJnj8d4P7Q8W4hObNqdWxAqU0P")
    typeof parsed.id === "string" && parsed.id.startsWith("VL")
      ? parsed.id.slice(2)
      : undefined,
    parsed.videoId,
    ...collectWatchVideoIdsFromParsedFlexColumns(parsed),
    parsed.video_id,
    parsed.videoId_,
    parsed.playlistItemData?.videoId,
    // Endpoint paths (common in parsed MusicResponsiveListItem)
    parsed.endpoint?.payload?.videoId,
    parsed.endpoint?.payload?.video_id,
    parsed.endpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    // Overlay paths
    parsed.overlay?.content?.play_button?.endpoint?.payload?.videoId,
    parsed.overlay?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchEndpoint?.videoId,
    parsed.thumbnail_overlay?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId,
    parsed.navigation_endpoint?.payload?.videoId,
    parsed.navigation_endpoint?.watch_endpoint?.video_id,
    // Raw data fallback
    parsed.raw_data?.videoId,
    parsed.raw_data?.navigationEndpoint?.watchEndpoint?.videoId,
    // Subtitle runs
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    // Menu items
    ...menuItems.map(
      (item: any) =>
        item?.navigation_endpoint?.watch_endpoint?.video_id ||
        item?.navigation_endpoint?.watch_endpoint?.videoId ||
        item?.service_endpoint?.queue_add_endpoint?.queue_target?.video_id ||
        item?.service_endpoint?.queue_add_endpoint?.queue_target?.videoId,
    ),
    // Top-level buttons
    ...topLevelButtons.map(
      (item: any) =>
        item?.navigation_endpoint?.watch_endpoint?.video_id ||
        item?.navigation_endpoint?.watch_endpoint?.videoId ||
        item?.button_renderer?.navigation_endpoint?.watch_endpoint?.video_id,
    ),
  ]);
  if (directId) return directId;

  return undefined;
}

function toTrack(
  item: MusicResponsiveListItem | MusicTwoRowItem,
): TrackResult | null {
  const providerId = readParsedItemPlayableVideoId(item);
  if (!providerId) {
    return null;
  }

  const itemAny = item as any;

  const title =
    itemAny.title?.toString() || itemAny.name?.toString() || "Unknown Track";

  const artists =
    Array.isArray(itemAny.artists) && itemAny.artists.length > 0
      ? itemAny.artists
          .map((artist: { name?: string }) => artist.name)
          .filter(Boolean)
          .join(", ")
      : itemAny.author?.name ||
        itemAny.subtitle?.toString() ||
        "Unknown Artist";

  const album =
    itemAny.album?.name ||
    (itemAny.subtitle?.toString()?.includes(" • ")
      ? itemAny.subtitle.toString().split(" • ")[0]
      : "Single");

  const durationParsed = itemAny.duration;
  const seconds =
    typeof durationParsed === "object"
      ? durationParsed?.seconds
      : typeof durationParsed === "number"
        ? durationParsed
        : undefined;
  const time =
    typeof durationParsed === "object"
      ? durationParsed?.text
      : typeof durationParsed === "string"
        ? durationParsed
        : formatDuration(seconds);

  // Extract liked status from menu items if available
  let liked = false;
  try {
    const menuItems = itemAny.menu?.items || [];
    for (const menuItem of menuItems) {
      const toggleRenderer = menuItem.as?.(YTNodes.ToggleMenuServiceItem);
      if (toggleRenderer) {
        const iconType =
          toggleRenderer.icon_type || toggleRenderer.default_icon_type;
        if (iconType === "FAVORITE" || iconType === "LIKE") {
          liked = toggleRenderer.is_toggled || (toggleRenderer as any).toggled;
          break;
        }
      }
    }
  } catch {
    // Fallback for raw data or other structures
    const menuItems =
      itemAny.menu?.items || itemAny.menu?.menu_renderer?.items || [];
    for (const m of menuItems) {
      const entry =
        m.menuNavigationItemRenderer ||
        m.menuServiceItemRenderer ||
        m.toggleMenuServiceItemRenderer;
      if (entry) {
        const iconType =
          entry.defaultIcon?.iconType ||
          entry.default_icon_type ||
          entry.icon_type;
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

  const client = await Innertube.create({
    cookie,
    fetch: createFetchWithYtMusicAuth(cookie),
    retrieve_player: true,
    generate_session_locally: true,
  });

  return client;
}

function attachCredentialPersistence(
  client: Innertube,
  createdAt?: number,
): void {
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

async function resolveProfileName(
  client: Innertube,
): Promise<Pick<AuthStatusResult, "profileName" | "avatarUrl">> {
  try {
    const accounts = await client.account.getInfo(true);
    const selected =
      accounts.find((account) => account.is_selected) ?? accounts[0];

    return {
      profileName: selected?.account_name?.toString() ?? "YouTube Music",
      avatarUrl:
        selected?.account_photo?.[selected.account_photo.length - 1]?.url,
    };
  } catch {
    return {
      profileName: "YouTube Music",
    };
  }
}

async function buildAuthStatus(): Promise<AuthStatusResult> {
  const cache = loadCache();
  const client = cachedClient ?? (await restoreClientFromDisk());

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
      error:
        error instanceof Error
          ? error.message
          : "Failed to initialize YouTube Music session.",
    };
  }

  return cachedAuthStatus;
}

type RawNode = Record<string, any>;

function readRunsText(runs?: Array<{ text?: string }>): string {
  return Array.isArray(runs)
    ? runs
        .map((run) => run.text ?? "")
        .join("")
        .trim()
    : "";
}

function readText(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw.simpleText === "string") return raw.simpleText.trim();
  return readRunsText(raw.runs);
}

function isLikelyVideoId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(value) &&
    !/^(VL|PL|LM|MPR|FEmusic_)/.test(value)
  );
}

/** Strip app / browse prefixes so InnerTube gets a bare list id (e.g. PL…, LM…). */
function normalizeBareYtMusicPlaylistId(playlistId: string): string {
  let id = playlistId.trim();
  id = id
    .replace(/^ytmusic-playlist:/i, "")
    .replace(/^ytmusic:/i, "")
    .trim();
  if (id.startsWith("VL") && id.length > 2) {
    id = id.slice(2);
  }
  return id;
}

/**
 * Reject channel rows, UI tokens, and other non-list browse ids that sometimes appear on shelves.
 * Prefer failing closed so we do not call /browse with ids like "SE".
 */
function isPlausibleYtMusicPlaylistOrAlbumId(id: string): boolean {
  const t = id.trim();
  // Known special browse IDs that are valid despite being short
  if (t === "LM" || t === "SE" || t === "TP") {
    return true;
  }
  if (t.length < 4) {
    return false;
  }
  if (/^[A-Z]{1,3}$/.test(t)) {
    return false;
  }
  if (t.startsWith("UC")) {
    return false;
  }
  if (t.startsWith("FEmusic") || t.startsWith("FE")) {
    return false;
  }
  if (t.startsWith("MPRE") || t.startsWith("OLAK")) {
    return t.length >= 8;
  }
  if (t.startsWith("PL") || t.startsWith("LM")) {
    return t.length >= 6;
  }
  if (t.startsWith("RD")) {
    return t.length >= 8;
  }
  if (t.startsWith("VL")) {
    return t.length >= 10;
  }
  return t.length >= 12;
}

/** VL prefix is for list-style browse ids; album/release pages use bare MPRE/OLAK. */
function browseIdForMusicBrowseRequest(playlistId: string): string {
  if (playlistId.startsWith("VL")) {
    return playlistId;
  }
  if (playlistId.startsWith("MPRE") || playlistId.startsWith("OLAK")) {
    return playlistId;
  }
  return `VL${playlistId}`;
}

/** InnerTube sometimes expects the browse-style id (VL + list id) for edit/delete. */
function playlistIdsToTryOnInnertube(bareId: string): string[] {
  if (bareId.startsWith("VL")) {
    return [bareId];
  }
  const withVl = `VL${bareId}`;
  if (
    bareId.startsWith("PL") ||
    bareId.startsWith("LM") ||
    bareId.startsWith("OL")
  ) {
    return [bareId, withVl];
  }
  return [bareId];
}

function readBrowseIdFromYtmusicSearchItem(item: any): string | undefined {
  const ep = item?.endpoint as { payload?: Record<string, any> } | undefined;
  const p = ep?.payload;
  if (!p || typeof p !== "object") {
    return undefined;
  }
  const nested =
    typeof p.browseEndpoint?.browseId === "string"
      ? p.browseEndpoint.browseId
      : undefined;
  const flat = typeof p.browseId === "string" ? p.browseId : undefined;
  return nested || flat || undefined;
}

function findFirstVideoId(values: unknown[]): string | undefined {
  return values.find((value): value is string => isLikelyVideoId(value));
}

function collectWatchVideoIdsFromFlexColumns(renderer: RawNode): string[] {
  const cols = renderer?.flexColumns;
  if (!Array.isArray(cols)) {
    return [];
  }
  const out: string[] = [];
  for (const col of cols) {
    const runs =
      col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    for (const run of runs) {
      const vid = run?.navigationEndpoint?.watchEndpoint?.videoId;
      if (typeof vid === "string") {
        out.push(vid);
      }
    }
  }
  return out;
}

function readRendererPlayableVideoId(renderer: RawNode): string | undefined {
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  const topLevelButtons = renderer?.menu?.menuRenderer?.topLevelButtons ?? [];
  const subtitleRuns =
    renderer?.subtitle?.runs ??
    renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs ??
    [];

  return findFirstVideoId([
    renderer?.playlistItemData?.videoId,
    renderer?.navigationEndpoint?.watchEndpoint?.videoId,
    ...collectWatchVideoIdsFromFlexColumns(renderer),
    renderer?.navigationEndpoint?.watchPlaylistEndpoint?.videoId,
    renderer?.navigationEndpoint?.browseEndpoint?.browseId,
    renderer?.navigationEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType === "MUSIC_VIDEO_TYPE_ATV"
      ? renderer?.navigationEndpoint?.watchEndpoint?.videoId
      : undefined,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId,
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId,
    ...subtitleRuns.map((run: any) => run?.endpoint?.payload?.videoId),
    ...menuItems.map(
      (item: any) =>
        item?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint
          ?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.menuNavigationItemRenderer?.navigationEndpoint
          ?.watchPlaylistEndpoint?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint
          ?.queueTarget?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.toggleMenuServiceItemRenderer?.defaultServiceEndpoint
          ?.queueAddEndpoint?.queueTarget?.videoId,
    ),
    ...menuItems.map(
      (item: any) =>
        item?.toggleMenuServiceItemRenderer?.toggledServiceEndpoint
          ?.queueAddEndpoint?.queueTarget?.videoId,
    ),
    ...topLevelButtons.map(
      (button: any) =>
        button?.buttonRenderer?.navigationEndpoint?.watchEndpoint?.videoId,
    ),
    ...topLevelButtons.map(
      (button: any) =>
        button?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint
          ?.videoId,
    ),
  ]);
}

function readRendererPlaylistId(renderer: RawNode): string | undefined {
  return (
    renderer?.navigationEndpoint?.browseEndpoint?.browseId ??
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId ??
    renderer?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint
      ?.videoId
  );
}

function toTrackFromRaw(renderer: RawNode): TrackResult | null {
  const providerId = readRendererPlayableVideoId(renderer);
  if (!providerId) {
    return null;
  }

  const title =
    readText(
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text,
    ) ||
    readText(renderer.title) ||
    "Unknown Track";

  const detailRuns =
    renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs ??
    renderer.subtitle?.runs ??
    [];

  const artists = detailRuns
    .filter((run: any) =>
      run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("UC"),
    )
    .map((run: any) => run.text)
    .join(", ");

  const albumRun = detailRuns.find((run: any) =>
    run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith?.("MPR"),
  );
  const durationText =
    detailRuns.find((run: any) =>
      /^\d{1,2}:\d{2}(?::\d{2})?$/.test(run?.text ?? ""),
    )?.text ??
    readText(
      renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer
        ?.text,
    );

  let liked = false;
  const menuItems = renderer?.menu?.menuRenderer?.items ?? [];
  for (const m of menuItems) {
    const entry = m.toggleMenuServiceItemRenderer;
    if (
      entry?.defaultIcon?.iconType === "FAVORITE" ||
      entry?.default_icon_type === "FAVORITE"
    ) {
      liked = !!(entry.isToggled || entry.is_toggled);
      break;
    }
  }

  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title: sanitizeText(title, "Unknown Track"),
    artist: sanitizeText(
      artists || readText(renderer.subtitle),
      "Unknown Artist",
    ),
    album: sanitizeText(albumRun?.text ?? "Single", "Single"),
    duration: readDurationSeconds(durationText),
    time: durationText || formatDuration(readDurationSeconds(durationText)),
    genre: "YouTube Music",
    picture: getCachedTrackPicture(providerId, getThumbnailUrl(renderer)),
    sourceLabel: "YouTube Music",
    liked,
  };
}

function summarizeFailedTrackRenderer(renderer: RawNode) {
  return {
    title:
      readText(renderer?.title) ||
      readText(
        renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
          ?.text,
      ) ||
      null,
    navigationEndpoint: renderer?.navigationEndpoint ?? null,
    thumbnailOverlay: renderer?.thumbnailOverlay ?? null,
    menuItems: (renderer?.menu?.menuRenderer?.items ?? []).slice(0, 2),
    topLevelButtons: (
      renderer?.menu?.menuRenderer?.topLevelButtons ?? []
    ).slice(0, 2),
  };
}

function readNestedBrowseEndpoint(node: RawNode): RawNode | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.browseEndpoint && typeof node.browseEndpoint === "object") {
    return node.browseEndpoint;
  }

  const persistCommand =
    node.musicLibraryPersistLaunchNavigationCommand?.command;
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

function readChipBrowseEndpoint(
  chip: RawNode | undefined | null,
): RawNode | null {
  if (!chip) {
    return null;
  }
  return readNestedBrowseEndpoint(chip);
}

function parsePlaylistListedCountFromRenderer(
  renderer: RawNode,
): number | undefined {
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
  if (
    !providerId ||
    (!providerId.startsWith("VL") &&
      !providerId.startsWith("PL") &&
      !providerId.startsWith("LM"))
  ) {
    return null;
  }

  const name =
    readText(renderer.title) ||
    readText(
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text,
    ) ||
    "Playlist";
  return {
    id: `ytmusic:${providerId.replace(/^VL/, "")}`,
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
  const hasHint =
    typeof cached.listedItemCount === "number" && cached.listedItemCount > 0;

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

async function getYtMusicPlaylistFromRaw(
  client: Innertube,
  playlistId: string,
): Promise<PlaylistResult | null> {
  const raw = await client.actions.execute("/browse", {
    browseId: browseIdForMusicBrowseRequest(playlistId),
    client: "YTMUSIC",
  });
  const payload = raw.data;

  // Collect renderers across all continuation pages
  const allRenderers: RawNode[] = [];
  let currentPage: any = payload;
  while (currentPage) {
    const pageRenderers = [
      ...collectRenderers(currentPage, "musicResponsiveListItemRenderer"),
      ...collectRenderers(currentPage, "musicTwoRowItemRenderer"),
      ...collectCandidateMusicNodes(currentPage),
    ];
    allRenderers.push(...pageRenderers);

    const token = extractContinuationToken(currentPage);
    if (!token) break;

    try {
      const response = await client.actions.execute("/browse", {
        continuation: token,
        client: "YTMUSIC",
      });
      currentPage = response.data;
    } catch (err) {
      log(
        "ytmusic",
        "error",
        "getYtMusicPlaylistFromRaw: continuation failed",
        err,
      );
      break;
    }
  }

  const tracks = uniqueById(
    allRenderers
      .map((renderer) => toTrackFromRaw(renderer))
      .filter((track): track is TrackResult => track != null),
  );

  if (tracks.length === 0) {
    return null;
  }

  const headerTitle =
    readText(payload?.header?.musicDetailHeaderRenderer?.title) ||
    readText(
      payload?.header?.musicEditablePlaylistDetailHeaderRenderer?.header
        ?.musicDetailHeaderRenderer?.title,
    ) ||
    readText(payload?.header?.musicResponsiveHeaderRenderer?.title) ||
    "Playlist";

  return {
    id: `ytmusic:${playlistId}`,
    provider: "ytmusic",
    providerId: playlistId,
    name: headerTitle,
    editable: true,
    entries: toPlaylistEntries(tracks),
    tracks,
    listedItemCount: tracks.length,
  };
}

async function collectPlaylistItems(
  playlist: Awaited<ReturnType<Innertube["music"]["getPlaylist"]>>,
) {
  const items = [...playlist.items];
  let current = playlist;

  log(
    "ytmusic",
    "info",
    `collectPlaylistItems: starting with ${items.length} initial items`,
  );

  while (current.has_continuation) {
    try {
      current = await current.getContinuation();
      items.push(...current.items);
      log(
        "ytmusic",
        "info",
        `collectPlaylistItems: fetched continuation, now have ${items.length} items`,
      );
    } catch (err) {
      log(
        "ytmusic",
        "error",
        "collectPlaylistItems: failed to fetch continuation",
        err,
      );
      break;
    }
  }

  const tracks = items
    .map((item, idx) => {
      const track = toTrack(item as MusicResponsiveListItem | MusicTwoRowItem);
      if (!track) {
        log(
          "ytmusic",
          "warn",
          `collectPlaylistItems: failed to parse item at index ${idx}`,
          {
            type: (item as any).type,
            keys: Object.keys(item),
          },
        );
      }
      return track;
    })
    .filter((item): item is TrackResult => item != null);

  log(
    "ytmusic",
    "info",
    `collectPlaylistItems: finished with ${tracks.length} parsed tracks out of ${items.length} total items`,
  );
  return uniqueById(tracks);
}

function collectRenderers(
  node: any,
  key: string,
  results: RawNode[] = [],
): RawNode[] {
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

function collectCandidateMusicNodes(
  node: any,
  results: RawNode[] = [],
): RawNode[] {
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

function collectRendererKeyCounts(
  node: any,
  counts = new Map<string, number>(),
): Map<string, number> {
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
  const normalizedMessage =
    `${summary.message} ${summary.subtext} ${summary.button}`.toLowerCase();
  const signedOut =
    normalizedMessage.includes("sign in") ||
    normalizedMessage.includes("access tracks that you liked or saved") ||
    normalizedMessage.includes("explore your favorites");

  if (signedOut) {
    return {
      authenticated: false,
      message:
        "Imported browser session is not being accepted by YouTube Music. Please reload the extension from a logged-in music.youtube.com tab and retry.",
    };
  }

  return { authenticated: true };
}

function extractContinuationToken(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  // Try continuationContents (continuation page response)
  if (data.continuationContents) {
    for (const value of Object.values(data.continuationContents)) {
      const container = value as any;
      if (container?.continuations?.[0]?.nextContinuationData?.continuation) {
        return container.continuations[0].nextContinuationData.continuation;
      }
      if (container?.continuations?.[0]?.reloadContinuationData?.continuation) {
        return container.continuations[0].reloadContinuationData.continuation;
      }
    }
    // No continuation token found in continuationContents means we're on the last page
    return null;
  }

  // Try shelf/browse continuations (initial page - contents is an array of sections)
  if (Array.isArray(data.contents)) {
    for (const section of data.contents) {
      const shelf =
        section?.musicShelfRenderer || section?.musicCarouselShelfRenderer;
      if (shelf?.continuations?.[0]?.nextContinuationData?.continuation) {
        return shelf.continuations[0].nextContinuationData.continuation;
      }
      if (shelf?.continuations?.[0]?.reloadContinuationData?.continuation) {
        return shelf.continuations[0].reloadContinuationData.continuation;
      }
    }
  }

  // Try sectionListRenderer continuations (initial page with section list)
  if (Array.isArray(data.contents)) {
    const sectionList = data.contents[0]?.sectionListRenderer;
    if (sectionList?.continuations?.[0]?.nextContinuationData?.continuation) {
      return sectionList.continuations[0].nextContinuationData.continuation;
    }
    if (sectionList?.continuations?.[0]?.reloadContinuationData?.continuation) {
      return sectionList.continuations[0].reloadContinuationData.continuation;
    }
  }

  return null;
}

async function collectTracksWithContinuation(
  client: Innertube,
  initialPage: any,
  pageLabel: string,
): Promise<RawNode[]> {
  const allRenderers: RawNode[] = [];
  let currentPage = initialPage;
  let pageNum = 0;

  while (currentPage) {
    const pageRenderers = [
      ...collectRenderers(currentPage, "musicResponsiveListItemRenderer"),
      ...collectRenderers(currentPage, "musicTwoRowItemRenderer"),
    ];

    allRenderers.push(...pageRenderers);
    log(
      "ytmusic",
      "info",
      `${pageLabel}: collected ${pageRenderers.length} renderers from page ${pageNum} (total: ${allRenderers.length})`,
    );

    const token = extractContinuationToken(currentPage);
    if (!token) {
      log("ytmusic", "info", `${pageLabel}: no continuation token found, done`);
      break;
    }

    pageNum++;
    try {
      const response = await client.actions.execute("/browse", {
        continuation: token,
        client: "YTMUSIC",
      });
      currentPage = response.data;
    } catch (err) {
      log(
        "ytmusic",
        "error",
        `${pageLabel}: failed to fetch continuation page ${pageNum}`,
        err,
      );
      break;
    }
  }

  return allRenderers;
}

async function getLibraryPageData(
  client: Innertube,
  filter?: string,
): Promise<any> {
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
    message:
      "Automatic sign-in is unavailable for YouTube Music. Import your browser cookies instead.",
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
      error:
        "Paste a valid Cookie header from a logged-in music.youtube.com session.",
    };
  }

  const cookiePresence = getCookiePresence(normalizedCookie);
  const reportedCookieNames = details?.cookieNames ?? [];
  const hasImportedAuthCookie = hasRequiredAuthCookie(normalizedCookie);
  if (!hasImportedAuthCookie) {
    log(
      "ytmusic",
      "warn",
      "Rejected imported browser session without auth cookies",
      {
        sourceUrl: details?.sourceUrl ?? null,
        reportedCookieNames,
        cookiePresence,
      },
    );
    return {
      success: false,
      error:
        "The imported browser session is missing the YouTube Music auth cookies required for sign-in. Open music.youtube.com in the same browser profile, make sure you're logged in, and try again.",
    };
  }

  try {
    const client = await validateCookieClient(normalizedCookie);
    if (!persistCookieString(normalizedCookie)) {
      return {
        success: false,
        error:
          "Could not securely store the YouTube Music session on this machine.",
      };
    }

    pendingLogin = null;
    cachedClient = client;
    loggedLibraryAuthDebug = false;
    bumpYtMusicSearchCacheSession();
    const auth = await buildAuthStatus();
    return {
      success: auth.loggedIn,
      auth,
      error: auth.loggedIn ? undefined : auth.error,
    };
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
      error:
        error instanceof Error
          ? error.message
          : "Failed to validate the YouTube Music cookies.",
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
      error:
        "Paste a valid Cookie header from a logged-in music.youtube.com session.",
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
      error:
        "The imported browser session is missing the required YouTube Music auth cookies.",
    };
  }

  if (!persistCookieString(normalizedCookie)) {
    return {
      success: false,
      error:
        "Could not securely store the YouTube Music session on this machine.",
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
  const cachedPlaylists = new Map(
    existingCache.playlists.map((playlist) => [playlist.id, playlist]),
  );
  const libraryPage = await getLibraryPageData(client);
  const libraryAuthState = classifyLibraryAuthState(libraryPage);
  if (!libraryAuthState.authenticated) {
    const storedSession = loadStoredYtMusicSession();
    log("ytmusic", "warn", "Library sync rejected by YouTube Music", {
      cookiePresence: getCookiePresence(
        storedSession?.auth.kind === "cookie"
          ? storedSession.auth.cookie
          : undefined,
      ),
      libraryMessage: getLibraryMessageSummary(libraryPage),
    });
    throw new Error(libraryAuthState.message);
  }

  const availableFilters = collectRenderers(
    libraryPage,
    "chipCloudChipRenderer",
  ).map((entry) => readText(entry.text));
  const tracksPage = availableFilters.includes("Songs")
    ? await getLibraryPageData(client, "Songs")
    : libraryPage;
  const playlistPage = availableFilters.includes("Playlists")
    ? await getLibraryPageData(client, "Playlists")
    : libraryPage;
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
  const trackRenderers = await collectTracksWithContinuation(
    client,
    tracksPage,
    "Songs",
  );
  const playlistRenderers = [
    ...collectRenderers(playlistPage, "musicResponsiveListItemRenderer"),
    ...collectRenderers(playlistPage, "musicTwoRowItemRenderer"),
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

  const failedTrackCandidates =
    tracks.length === 0
      ? trackRenderers
          .filter(
            (renderer) =>
              renderer?.title ||
              renderer?.flexColumns?.[0] ||
              renderer?.navigationEndpoint ||
              renderer?.menu,
          )
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
      sampleTrackKeys: trackRenderers[0]
        ? Object.keys(trackRenderers[0]).slice(0, 10)
        : [],
      samplePlaylistKeys: playlistRenderers[0]
        ? Object.keys(playlistRenderers[0]).slice(0, 10)
        : [],
      topTrackRenderers: getTopRendererKeys(tracksPage, 15),
      topPlaylistRenderers: getTopRendererKeys(playlistPage, 15),
      trackMessage: getLibraryMessageSummary(tracksPage),
      playlistMessage: getLibraryMessageSummary(playlistPage),
      trackFilterEndpointKeys: availableFilters.includes("Songs")
        ? Object.keys(
            readChipBrowseEndpoint(
              collectRenderers(libraryPage, "chipCloudChipRenderer").find(
                (entry) => readText(entry.text) === "Songs",
              ),
            ) ?? {},
          )
        : [],
      failedTrackCandidates,
      rawDumpPaths,
    });
  }

  const playlists = playlistSummaries.map((playlist) =>
    mergePlaylistSummaryWithCachedDetail(
      playlist,
      cachedPlaylists.get(playlist.id),
    ),
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
  const allTracks = result.sections.flatMap((s) =>
    s.items.filter(
      (i): i is TrackResult => "provider" in i && i.provider === "ytmusic",
    ),
  );
  return {
    tracks: uniqueById(allTracks).slice(0, 25),
  };
}

export async function getYtMusicHomeFeed(): Promise<YTMusicHomeFeedResult> {
  const client = await getClient();
  let homeFeed = await client.music.getHomeFeed();
  const sections: YTMusicHomeSectionResult[] = [];

  const processSections = (feedSections: any[]) => {
    for (const section of feedSections) {
      try {
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
          const shelf = section as any;
          title =
            shelf.header?.title?.toString() ||
            shelf.title?.toString() ||
            "Recommended";
          shelfContents = shelf.contents || [];
        } else {
          continue;
        }

        const items: (TrackResult | PlaylistResult)[] = [];
        for (const rawItem of shelfContents) {
          const track = toTrack(rawItem);
          if (track) {
            items.push(track);
          } else {
            const playlist = toPlaylist(rawItem);
            if (playlist) {
              items.push(playlist);
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
  };

  if (homeFeed.sections) {
    processSections(homeFeed.sections);
  }

  // Fetch more sections if available to get a richer feed (Listen again, Quick picks, etc.)
  // We try up to 3 continuations or until we have a good number of sections
  let continuationCount = 0;
  while (
    homeFeed.has_continuation &&
    continuationCount < 3 &&
    sections.length < 15
  ) {
    try {
      log(
        "ytmusic",
        "info",
        `Fetching home feed continuation ${continuationCount + 1}`,
      );
      homeFeed = await homeFeed.getContinuation();
      if (homeFeed.sections) {
        processSections(homeFeed.sections);
      }
      continuationCount++;
    } catch (err) {
      log("ytmusic", "warn", "Failed to fetch home feed continuation", err);
      break;
    }
  }

  log(
    "ytmusic",
    "info",
    `Returning home feed with ${sections.length} sections after ${continuationCount} continuations`,
  );
  return { sections };
}

export async function searchYtMusic(query: string): Promise<{
  tracks: TrackResult[];
  albums: PlaylistResult[];
  playlists: PlaylistResult[];
}> {
  const client = await getClient();

  // Search for different types in parallel for efficiency
  const [songResults, albumResults, playlistResults] = await Promise.all([
    client.music.search(query, { type: "song" }),
    client.music.search(query, { type: "album" }),
    client.music.search(query, { type: "playlist" }),
  ]);

  const tracks = (songResults.songs?.contents ?? [])
    .map((item) => toTrack(item))
    .filter((item): item is TrackResult => item != null);

  const albums = (albumResults.albums?.contents ?? [])
    .map((item) => toPlaylist(item))
    .filter((item): item is PlaylistResult => item != null);

  const playlists = (playlistResults.playlists?.contents ?? [])
    .map((item) => toPlaylist(item))
    .filter((item): item is PlaylistResult => item != null);

  return {
    tracks: uniqueById(tracks),
    albums: uniqueById(albums),
    playlists: uniqueById(playlists),
  };
}

export async function getYtMusicPlaylist(
  playlistId: string,
): Promise<PlaylistResult | null> {
  const client = await getClient();
  const bareId = normalizeBareYtMusicPlaylistId(playlistId);
  if (!isPlausibleYtMusicPlaylistOrAlbumId(bareId)) {
    log("ytmusic", "warn", "Rejected implausible playlist / album browse id", {
      playlistId: bareId,
    });
    return null;
  }

  // Try to fetch as an album if the ID looks like one
  if (bareId.startsWith("MPRE") || bareId.startsWith("OLAK")) {
    try {
      log("ytmusic", "info", `Attempting to fetch as album: ${bareId}`);
      const album = await client.music.getAlbum(bareId);

      const tracks: TrackResult[] = [];
      const seen = new Set<string>();
      const pushTrack = (t: TrackResult | null) => {
        if (!t || seen.has(t.id)) {
          return;
        }
        seen.add(t.id);
        tracks.push(t);
      };

      for (const item of (album as any).items ?? []) {
        pushTrack(toTrack(item));
      }

      for (const section of album.sections || []) {
        for (const item of (section as any).items ?? []) {
          pushTrack(toTrack(item));
        }
      }

      if (tracks.length > 0) {
        const albumHeader = album.header as any;
        const detailed = {
          id: `ytmusic:${bareId}`,
          provider: "ytmusic" as const,
          providerId: bareId,
          name: album.header?.title?.toString() || "Album",
          author: albumHeader?.author?.name || "YouTube Music",
          picture: getThumbnailUrl(albumHeader),
          type: "album" as const,
          editable: false,
          entries: toPlaylistEntries(tracks),
          tracks,
          listedItemCount: tracks.length,
        };
        upsertCachedPlaylist(detailed);
        return detailed;
      }

      const rawAlbum = await getYtMusicPlaylistFromRaw(client, bareId);
      if (rawAlbum) {
        const withType: PlaylistResult = {
          ...rawAlbum,
          id: `ytmusic:${bareId}`,
          providerId: bareId,
          type: "album",
          editable: false,
        };
        upsertCachedPlaylist(withType);
        return withType;
      }
    } catch (error) {
      log("ytmusic", "warn", "Album fetch failed, trying raw browse fallback", {
        playlistId: bareId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        const rawAlbum = await getYtMusicPlaylistFromRaw(client, bareId);
        if (rawAlbum) {
          const withType: PlaylistResult = {
            ...rawAlbum,
            id: `ytmusic:${bareId}`,
            providerId: bareId,
            type: "album",
            editable: false,
          };
          upsertCachedPlaylist(withType);
          return withType;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  try {
    const playlist = await client.music.getPlaylist(bareId);
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
      id: `ytmusic:${bareId}`,
      provider: "ytmusic" as const,
      providerId: bareId,
      name,
      author: (header as any)?.author?.name || "YouTube Music",
      picture: getThumbnailUrl(header),
      type:
        bareId.startsWith("MPRE") || bareId.startsWith("OLAK")
          ? ("album" as const)
          : ("playlist" as const),
      editable: false,
      entries: toPlaylistEntries(tracks),
      tracks,
      listedItemCount: tracks.length,
    };

    upsertCachedPlaylist(detailed);
    return detailed;
  } catch (error) {
    log(
      "ytmusic",
      "warn",
      "Parsed playlist fetch failed, falling back to raw extraction",
      {
        playlistId: bareId,
        error: error instanceof Error ? error.message : String(error),
      },
    );

    const detailed = await getYtMusicPlaylistFromRaw(client, bareId);
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

export async function likeYtMusicTrack(
  videoId: string,
): Promise<{ success: boolean }> {
  const client = await getClient();
  // Using actions.execute directly with target as an object.
  // The error "Invalid value at 'target' ... \"qFTo8PUBoQ0\"" suggests that the API
  // expected an object but got a string. We wrap it explicitly.
  await client.actions.execute("/like/like", {
    target: { videoId },
  });
  return { success: true };
}

export async function unlikeYtMusicTrack(
  videoId: string,
): Promise<{ success: boolean }> {
  const client = await getClient();
  await client.actions.execute("/like/removerating", {
    target: { videoId },
  });
  return { success: true };
}

export async function createYtMusicPlaylist(
  name: string,
  trackProviderIds: string[] = [],
) {
  const client = await getClient();
  const response = await client.playlist.create(name, trackProviderIds);
  return {
    success: !!response.success,
    playlistId: response.playlist_id,
  };
}

export async function renameYtMusicPlaylist(playlistId: string, name: string) {
  const client = await getClient();
  const bareId = normalizeBareYtMusicPlaylistId(playlistId);
  // youtubei.js PlaylistManager.setName sends `playlist_id` inside playlistEditEndpoint; the
  // library's PlaylistEditEndpoint only serializes `playlistId`, so the request body was invalid.
  const actions = [{ action: "ACTION_SET_PLAYLIST_NAME", playlistName: name }];
  let lastError: unknown;
  for (const pid of playlistIdsToTryOnInnertube(bareId)) {
    try {
      await client.actions.execute("/browse/edit_playlist", {
        playlistId: pid,
        actions,
        client: "YTMUSIC",
      });
      return { success: true };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function deleteYtMusicPlaylist(playlistId: string) {
  const client = await getClient();
  const bareId = normalizeBareYtMusicPlaylistId(playlistId);
  // client.playlist.delete builds deletePlaylistServiceEndpoint, which NavigationEndpoint cannot
  // route (no api_url / parsed command). Call InnerTube directly like other YT Music actions.
  let lastError: unknown;
  for (const pid of playlistIdsToTryOnInnertube(bareId)) {
    try {
      await client.actions.execute("/playlist/delete", {
        playlistId: pid,
        client: "YTMUSIC",
      });
      return { success: true };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function addTrackToYtMusicPlaylist(
  playlistId: string,
  videoId: string,
) {
  const client = await getClient();
  await client.playlist.addVideos(playlistId, [videoId]);
  return { success: true };
}

export async function removeTrackFromYtMusicPlaylist(
  playlistId: string,
  videoId: string,
) {
  const client = await getClient();
  await client.playlist.removeVideos(playlistId, [videoId]);
  return { success: true };
}

export async function saveYtMusicPlaylist(playlistId: string) {
  const client = await getClient();
  const bareId = normalizeBareYtMusicPlaylistId(playlistId);

  // Albums use the like/unlike system in YT Music library
  if (bareId.startsWith("MPRE") || bareId.startsWith("OLAK")) {
    await client.actions.execute("/like/like", {
      target: { playlistId: bareId },
    });
  } else {
    await client.playlist.addToLibrary(bareId);
  }
  return { success: true };
}

export async function unsaveYtMusicPlaylist(playlistId: string) {
  const client = await getClient();
  const bareId = normalizeBareYtMusicPlaylistId(playlistId);

  if (bareId.startsWith("MPRE") || bareId.startsWith("OLAK")) {
    await client.actions.execute("/like/removerating", {
      target: { playlistId: bareId },
    });
  } else {
    await client.playlist.removeFromLibrary(bareId);
  }
  return { success: true };
}

export function getCachedYtMusicLibrary(): CacheShape {
  return loadCache();
}
