// YtDataModule — library sync, cache, CRUD, search, home feed
import fs from "node:fs";
import { Innertube, YTNodes } from "youtubei.js";
import type {
  PlaylistResult,
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
import { log } from "./logger";
import { getYtDlpDuration } from "./ytdlp";
import { formatDuration } from "./ytmusicStrings";
import { uniqueById } from "./utils";
import {
  browseIdForMusicBrowseRequest,
  classifyLibraryAuthState,
  collectCandidateMusicNodes,
  collectPlaylistItems,
  collectRenderers,
  extractContinuationToken,
  getLibraryMessageSummary,
  getThumbnailUrl,
  getTopRendererKeys,
  mergePlaylistSummaryWithCachedDetail,
  normalizeBareYtMusicPlaylistId,
  isPlausibleYtMusicPlaylistOrAlbumId,
  playlistIdsToTryOnInnertube,
  readChipBrowseEndpoint,
  readRendererPlayableVideoId,
  readText,
  summarizeFailedTrackRenderer,
  toPlaylist,
  toPlaylistEntries,
  toPlaylistFromRaw,
  toTrack,
  toTrackFromRaw,
  type RawNode,
} from "./ytmusicParsing";
import { getClient, getYtMusicSessionCookie, getCookiePresence, setCachedClient } from "./ytmusicClient";
import { loadStoredYtMusicSession, clearStoredYtMusicSession } from "./ytmusicSession";
import { createYtMusicSessionCookie } from "./ytmusicCookie";
import { clearYtMusicSearchCacheFile } from "./ytmusicSearchCache";
import { pLimit } from "./concurrency";

export type CacheShape = {
  tracks: TrackResult[];
  playlists: PlaylistResult[];
  lastSyncedAt?: number;
};

let _cachedTrackMeta:
  | Map<string, { duration: number; time: string }>
  | null
  | "loading"
  | "failed" = null;

const _fetchedTrackMeta = new Map<string, { duration: number; time: string }>();

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
    invalidateCachedTrackMeta();
    _fetchedTrackMeta.clear();
    return { success: true };
  } catch {
    return { success: false };
  }
}

function loadCachedTrackMeta(): void {
  if (_cachedTrackMeta !== null) return;
  try {
    _cachedTrackMeta = "loading";
    const cache = loadCache();
    const map = new Map<string, { duration: number; time: string }>();
    for (const t of cache.tracks) {
      if (t.duration > 0 && t.time && t.time !== "—") {
        map.set(t.id, { duration: t.duration, time: t.time });
      }
    }
    _cachedTrackMeta = map;
  } catch {
    _cachedTrackMeta = "failed";
  }
}

function fillMissingDurations(tracks: TrackResult[]): void {
  loadCachedTrackMeta();
  if (
    !_cachedTrackMeta ||
    _cachedTrackMeta === "loading" ||
    _cachedTrackMeta === "failed"
  )
    return;
  for (const track of tracks) {
    if (track.duration === 0 || track.time === "—") {
      const cached = _cachedTrackMeta.get(track.id);
      if (cached) {
        track.duration = cached.duration;
        track.time = cached.time;
      }
    }
  }
}

function invalidateCachedTrackMeta(): void {
  _cachedTrackMeta = null;
}



const MAX_DURATION_LOOKUPS_PER_CALL = 12;
const DURATION_BATCH_DEADLINE_MS = 8_000;

async function fetchBatchTrackDurations(tracks: TrackResult[]): Promise<void> {
  const client = await getClient().catch(() => null);
  const cookie = getYtMusicSessionCookie();

  const missing = tracks
    .filter(
      (t) => (t.duration === 0 || t.time === "—") && !_fetchedTrackMeta.has(t.id),
    )
    .slice(0, MAX_DURATION_LOOKUPS_PER_CALL);
  if (missing.length === 0) return;

  const deadline = Date.now() + DURATION_BATCH_DEADLINE_MS;

  await pLimit(missing, 3, async (track): Promise<void> => {
    if (Date.now() > deadline) return;
    if (_fetchedTrackMeta.has(track.id)) return;

    let seconds: number | null = null;

    if (client) {
      try {
        const info = await client.music.getInfo(track.providerId);
        const d = info?.basic_info?.duration;
        if (d && typeof d === "number" && d > 0) {
          seconds = d;
          log("ytmusic", "info", "Duration via youtubei.js", {
            videoId: track.providerId,
            duration: seconds,
          });
        }
      } catch (err) {
        log("ytmusic", "info", "youtubei.js duration fetch failed", {
          videoId: track.providerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (seconds === null) {
      try {
        seconds = await getYtDlpDuration(track.providerId, cookie);
        if (seconds !== null) {
          log("ytmusic", "info", "Duration via yt-dlp", {
            videoId: track.providerId,
            duration: seconds,
          });
        }
      } catch {
        // ignore
      }
    }

    if (seconds !== null && seconds > 0) {
      const time = formatDuration(seconds);
      _fetchedTrackMeta.set(track.id, { duration: seconds, time });
      track.duration = seconds;
      track.time = time;
    }
  });
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

async function collectTracksWithContinuation(
  client: Innertube,
  initialPage: any,
  pageLabel: string,
): Promise<RawNode[]> {
  const allRenderers: RawNode[] = [];
  let currentPage = initialPage;
  let pageNum = 0;
  let continuationCount = 0;
  const seenTokens = new Set<string>();

  while (currentPage && continuationCount < 3) {
    const pageRenderers = [
      ...collectRenderers(currentPage, "musicResponsiveListItemRenderer"),
      ...collectRenderers(currentPage, "musicTwoRowItemRenderer"),
    ];

    const before = allRenderers.length;
    allRenderers.push(...pageRenderers);
    log(
      "ytmusic",
      "info",
      `${pageLabel}: collected ${pageRenderers.length} renderers from page ${pageNum} (total: ${allRenderers.length})`,
    );

    if (allRenderers.length === before) {
      log("ytmusic", "info", `${pageLabel}: no new renderers, done`);
      break;
    }

    const token = extractContinuationToken(currentPage);
    if (!token) {
      log("ytmusic", "info", `${pageLabel}: no continuation token found, done`);
      break;
    }
    if (seenTokens.has(token)) {
      log("ytmusic", "info", `${pageLabel}: repeated continuation token, done`);
      break;
    }
    seenTokens.add(token);

    pageNum++;
    continuationCount++;
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

async function getYtMusicPlaylistFromRaw(
  client: Innertube,
  playlistId: string,
): Promise<PlaylistResult | null> {
  const raw = await client.actions.execute("/browse", {
    browseId: browseIdForMusicBrowseRequest(playlistId),
    client: "YTMUSIC",
  });
  const payload = raw.data;

  const allRenderers: RawNode[] = [];
  let currentPage: any = payload;
  let continuationCount = 0;
  const seenTokens = new Set<string>();
  while (currentPage && continuationCount < 3) {
    const pageRenderers = [
      ...collectRenderers(currentPage, "musicResponsiveListItemRenderer"),
      ...collectRenderers(currentPage, "musicTwoRowItemRenderer"),
      ...collectCandidateMusicNodes(currentPage),
    ];
    const before = allRenderers.length;
    allRenderers.push(...pageRenderers);
    if (allRenderers.length === before) break;

    const token = extractContinuationToken(currentPage);
    if (!token) break;
    if (seenTokens.has(token)) break;
    seenTokens.add(token);

    continuationCount++;
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

export async function getLibraryPageData(
  client: Innertube,
  filter?: string,
): Promise<any> {
  // Fetches the library page context from Innertube, optionally filtered by a
  // chip (e.g. "Songs" or "Playlists"). Used by syncYtMusicLibrary and by
  // ytmusicAuth.validateCookieClient to verify a session.
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
          ? createYtMusicSessionCookie(storedSession.auth.cookie)
          : undefined,
      ),
      libraryMessage: getLibraryMessageSummary(libraryPage),
    });
    
    // Clear bad session and cached client in the backend
    setCachedClient(null);
    clearStoredYtMusicSession();
    
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
  // Redundant sub-page auth checks removed to prevent false positives when tabs are empty or have promotional states.
  // The primary libraryPage check above is sufficient to verify session credentials.
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
  invalidateCachedTrackMeta();

  // Update cachedAuthStatus indirectly via getYtMusicAuthStatus (handled by renderer store loadAuthStatus).
  // YtDataModule doesn't manage auth status directly, but we let it trigger home snapshot.
  log("ytmusic", "info", "Library sync complete", {
    tracks: tracks.length,
    playlists: playlists.length,
  });

  if (loadSettings().ytmusicHomeSnapshotEnabled !== false) {
    // depends on getYtMusicHome — see HANDOFF.md Q4
    void getYtMusicHome().catch(() => undefined);
  }

  return { tracks, playlists, lastSyncedAt };
}

export async function getYtMusicHome(): Promise<YTMusicHomeResult> {
  const result = await getYtMusicHomeFeed();
  const allTracks = result.sections.flatMap((s) =>
    s.items.filter(
      (i): i is TrackResult =>
        "duration" in i && "providerId" in i && i.provider === "ytmusic",
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

  const allTracks: TrackResult[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      if ("duration" in item && "providerId" in item) {
        allTracks.push(item);
      }
    }
  }
  fillMissingDurations(allTracks);
  await fetchBatchTrackDurations(allTracks);

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

  fillMissingDurations(tracks);
  await fetchBatchTrackDurations(tracks);

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
      editable: true,
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

export async function likeYtMusicTrack(
  videoId: string,
): Promise<{ success: boolean }> {
  const client = await getClient();
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
