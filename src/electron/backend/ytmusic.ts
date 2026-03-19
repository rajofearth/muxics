import fs from "node:fs";
import crypto from "node:crypto";
import { Innertube } from "youtubei.js";
import type MusicResponsiveListItem from "youtubei.js/dist/src/parser/classes/MusicResponsiveListItem.js";
import type MusicTwoRowItem from "youtubei.js/dist/src/parser/classes/MusicTwoRowItem.js";
import type { Format } from "youtubei.js/dist/src/parser/misc.js";
import type {
  AuthLoginCompleteResult,
  AuthLoginStartResult,
  AuthStatusResult,
  ImportYtMusicSessionResult,
  PendingYtMusicLoginResult,
  PlaylistResult,
  TrackPlaybackResult,
  TrackResult,
  YTMusicHomeResult,
  YTMusicLibrarySyncResult,
} from "../../shared/desktop-contract";
import { ensureAppDataDirs, YTMUSIC_CACHE_PATH, YTMUSIC_DEBUG_DIR } from "./paths";
import { log } from "./logger";
import {
  clearStoredYtMusicSession,
  loadStoredYtMusicSession,
  persistCookieString,
  persistOAuthTokens,
} from "./ytmusicSession";

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
let nextPendingLoginId = 0;
let loggedLibraryAuthDebug = false;

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

function formatDuration(seconds?: number): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function sanitizeText(value: string | undefined | null, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
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
    const isYtMusicRequest = originalUrl.includes("/youtubei/v1/") && requestContext.isYtMusicRequest;
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
            duplex: "duplex" in input ? (input as Request & { duplex?: RequestDuplex }).duplex : undefined,
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

function getThumbnailUrl(item: { thumbnails?: { url: string }[]; thumbnail?: { contents?: { url: string }[] } | null }) {
  const thumbnails = item.thumbnails ?? item.thumbnail?.contents ?? [];
  return thumbnails[thumbnails.length - 1]?.url;
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

    const leftCipher = left.signature_cipher || left.cipher ? 1 : 0;
    const rightCipher = right.signature_cipher || right.cipher ? 1 : 0;
    if (leftCipher !== rightCipher) {
      return rightCipher - leftCipher;
    }

    const leftBitrate = left.average_bitrate ?? left.bitrate ?? 0;
    const rightBitrate = right.average_bitrate ?? right.bitrate ?? 0;
    return rightBitrate - leftBitrate;
  });
}

async function resolvePlaybackUrlFromFormats(
  client: Innertube,
  videoId: string,
): Promise<{ url: string; loudnessDb?: number } | null> {
  const info = await client.getBasicInfo(videoId);
  const streamingData = info.streaming_data;

  if (!streamingData) {
    log("ytmusic", "warn", "Playback info missing streaming data", { videoId });
    return null;
  }

  const candidateFormats = sortPlaybackFormats(
    [...streamingData.adaptive_formats, ...streamingData.formats].filter(
      (format) => format.has_audio && !format.is_type_otf,
    ),
  );

  if (candidateFormats.length === 0) {
    log("ytmusic", "warn", "No audio playback formats available", { videoId });
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

  log("ytmusic", "warn", "Failed every YT Music playback candidate", {
    videoId,
    candidates: candidateFormats.slice(0, 5).map((format) => ({
      itag: format.itag,
      mimeType: format.mime_type,
      hasAudio: format.has_audio,
      hasVideo: format.has_video,
      bitrate: format.average_bitrate ?? format.bitrate ?? 0,
      hasUrl: Boolean(format.url),
      hasSignatureCipher: Boolean(format.signature_cipher),
      hasCipher: Boolean(format.cipher),
    })),
    failures: failures.slice(0, 5),
  });

  return null;
}

function toTrack(item: MusicResponsiveListItem | MusicTwoRowItem): TrackResult | null {
  const providerId = item.id;
  if (!providerId) {
    return null;
  }

  const title = "title" in item
    ? sanitizeText(typeof item.title === "string" ? item.title : item.title?.toString(), "Unknown Track")
    : sanitizeText(item.name, "Unknown Track");
  const artists = "artists" in item && Array.isArray(item.artists) && item.artists.length > 0
    ? item.artists.map((artist) => artist.name).join(", ")
    : ("author" in item && item.author?.name) || "Unknown Artist";
  const album = "album" in item && item.album?.name
    ? item.album.name
    : "Single";
  const seconds = "duration" in item ? item.duration?.seconds : undefined;
  const time = "duration" in item && item.duration?.text
    ? item.duration.text
    : formatDuration(seconds);

  return {
    id: `ytmusic:${providerId}`,
    provider: "ytmusic",
    providerId,
    title,
    artist: sanitizeText(artists, "Unknown Artist"),
    album: sanitizeText(album, "Single"),
    duration: seconds ?? 0,
    time,
    genre: "YouTube Music",
    picture: getThumbnailUrl(item),
    sourceLabel: "YouTube Music",
  };
}

function toPlaylist(item: MusicResponsiveListItem | MusicTwoRowItem): PlaylistResult | null {
  const providerId = item.id;
  if (!providerId) {
    return null;
  }

  const name = "title" in item
    ? sanitizeText(typeof item.title === "string" ? item.title : item.title?.toString(), "Playlist")
    : sanitizeText(item.name, "Playlist");

  return {
    id: `ytmusic-playlist:${providerId}`,
    provider: "ytmusic",
    providerId,
    name,
    editable: true,
    entries: [],
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

async function collectShelfItems(
  feed: { contents?: Array<{ contents?: Array<MusicResponsiveListItem>; items?: Array<MusicTwoRowItem | MusicResponsiveListItem> }>; has_continuation?: boolean; getContinuation?: () => Promise<any> },
): Promise<Array<MusicResponsiveListItem | MusicTwoRowItem>> {
  const items: Array<MusicResponsiveListItem | MusicTwoRowItem> = [];
  let current: any = feed;

  while (current) {
    const currentItems = current.contents ?? [];
    for (const section of currentItems) {
      const sectionItems = section.contents ?? section.items ?? [];
      for (const item of sectionItems) {
        items.push(item);
      }
    }

    if (!current.has_continuation || typeof current.getContinuation !== "function") {
      break;
    }

    current = await current.getContinuation();
  }

  return items;
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

function readDurationSeconds(text: string): number {
  const parts = text.split(":").map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
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
    picture: getThumbnailUrl({
      thumbnails: renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
    }),
    sourceLabel: "YouTube Music",
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

function readChipBrowseEndpoint(chip: RawNode): RawNode | null {
  return readNestedBrowseEndpoint(chip);
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
  };
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

function findFilterToken(node: any, filter: string): string | null {
  const chips = collectRenderers(node, "chipCloudChipRenderer");
  const match = chips.find((chip) => readText(chip.text) === filter);
  const endpoint = readChipBrowseEndpoint(match);
  return endpoint?.continuation
    ?? endpoint?.params
    ?? endpoint?.browseId
    ?? null;
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

function clearPendingLoginIfCurrent(id: number): void {
  if (pendingLogin?.id === id) {
    pendingLogin = null;
  }
}

export async function getYtMusicAuthStatus(): Promise<AuthStatusResult> {
  return buildAuthStatus();
}

export async function loginToYtMusic(): Promise<AuthLoginStartResult> {
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
  return { success: true };
}

export async function logoutFromYtMusic(): Promise<AuthStatusResult> {
  pendingLogin = null;
  cachedClient = null;
  loggedLibraryAuthDebug = false;
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
  const rawDumpPaths = {
    library: writeDebugJson("library-landing.json", libraryPage),
    tracks: writeDebugJson("library-songs.json", tracksPage),
    playlists: writeDebugJson("library-playlists.json", playlistPage),
  };
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

  const playlists = await Promise.all(
    playlistSummaries.map(async (playlist) => {
      try {
        const detailed = await getYtMusicPlaylist(playlist.providerId);
        return detailed ?? playlist;
      } catch {
        return playlist;
      }
    }),
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

  return { tracks, playlists, lastSyncedAt };
}

export async function getYtMusicHome(): Promise<YTMusicHomeResult> {
  const client = await getClient();
  const home = await client.music.getHomeFeed();
  const items = await collectShelfItems(home as any);

  return {
    tracks: uniqueById(
      items.map((item) => toTrack(item)).filter((item): item is TrackResult => item != null),
    ).slice(0, 25),
  };
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
  const playlist = await client.music.getPlaylist(playlistId);

  const entries = playlist.items
    .map((item) => toTrack(item))
    .filter((item): item is TrackResult => item != null)
    .map((track) => ({
      id: track.id,
      provider: track.provider,
      providerId: track.providerId,
      title: track.title,
    }));

  const header = playlist.header;
  const name =
    ("title" in (header ?? {}) && (header as any).title?.toString?.()) ||
    ("name" in (header ?? {}) && (header as any).name?.toString?.()) ||
    "Playlist";

  return {
    id: `ytmusic-playlist:${playlistId}`,
    provider: "ytmusic",
    providerId: playlistId,
    name,
    editable: true,
    entries,
  };
}

export async function getYtMusicPlayback(trackId: string, providerId: string): Promise<TrackPlaybackResult> {
  try {
    const client = await getClient();
    const videoId = providerId || trackId.replace(/^ytmusic:/, "");
    const resolved = await resolvePlaybackUrlFromFormats(client, videoId);
    if (!resolved?.url) {
      return {
        mode: "unavailable",
        targetId: videoId,
        error: "No direct audio stream is available for this track.",
      };
    }

    return {
      mode: "direct",
      targetId: videoId,
      url: resolved.url,
      expiresAt: Date.now() + 1000 * 60 * 20,
      loudnessDb: resolved.loudnessDb,
    };
  } catch (error) {
    log("ytmusic", "warn", "Failed to resolve playback", error);
    return {
      mode: "unavailable",
      targetId: providerId || trackId.replace(/^ytmusic:/, ""),
      error: error instanceof Error ? error.message : "Playback is unavailable.",
    };
  }
}

export async function likeYtMusicTrack(videoId: string): Promise<{ success: boolean }> {
  const client = await getClient();
  await client.interact.like(videoId);
  return { success: true };
}

export async function unlikeYtMusicTrack(videoId: string): Promise<{ success: boolean }> {
  const client = await getClient();
  await client.interact.removeRating(videoId);
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
