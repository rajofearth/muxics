import fs from "node:fs";
import { BrowserWindow } from "electron";
import Innertube, { ClientType } from "youtubei.js";
import type MusicResponsiveListItem from "youtubei.js/dist/src/parser/classes/MusicResponsiveListItem.js";
import type MusicTwoRowItem from "youtubei.js/dist/src/parser/classes/MusicTwoRowItem.js";
import type { Format } from "youtubei.js/dist/src/parser/misc.js";
import type {
  AuthStatusResult,
  PlaylistResult,
  TrackPlaybackResult,
  TrackResult,
  YTMusicHomeResult,
  YTMusicLibrarySyncResult,
} from "../../shared/desktop-contract";
import { ensureAppDataDirs, YTMUSIC_CACHE_PATH } from "./paths";
import { log } from "./logger";
import {
  clearStoredYtMusicSession,
  clearYtMusicCookies,
  getYtMusicSession,
  hasYtMusicAuthCookies,
  persistCurrentYtMusicSession,
  readYtMusicCookieString,
  restoreYtMusicSessionFromDisk,
} from "./ytmusicSession";

type CacheShape = {
  tracks: TrackResult[];
  playlists: PlaylistResult[];
  lastSyncedAt?: number;
};

let cachedClient: Innertube | null = null;
let cachedAuthStatus: AuthStatusResult | null = null;

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

function getThumbnailUrl(item: { thumbnails?: { url: string }[]; thumbnail?: { contents?: { url: string }[] } | null }) {
  const thumbnails = item.thumbnails ?? item.thumbnail?.contents ?? [];
  return thumbnails[thumbnails.length - 1]?.url;
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

async function getClient(force = false): Promise<Innertube> {
  if (cachedClient && !force) {
    return cachedClient;
  }

  await restoreYtMusicSessionFromDisk();
  const cookie = await readYtMusicCookieString();
  if (!cookie) {
    throw new Error("No YouTube Music session is available.");
  }

  cachedClient = await Innertube.create({
    cookie,
    client_type: ClientType.MUSIC,
    retrieve_player: true,
    generate_session_locally: true,
  });

  return cachedClient;
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
  const persistent = !!(await restoreYtMusicSessionFromDisk());
  const hasCookies = await hasYtMusicAuthCookies();

  if (!hasCookies && !persistent) {
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent: false,
      lastSyncedAt: cache.lastSyncedAt,
    };
    return cachedAuthStatus;
  }

  try {
    const client = await getClient();
    const profile = await resolveProfileName(client);
    cachedAuthStatus = {
      loggedIn: true,
      provider: "ytmusic",
      persistent,
      lastSyncedAt: cache.lastSyncedAt,
      ...profile,
    };
  } catch (error) {
    cachedAuthStatus = {
      loggedIn: false,
      provider: "ytmusic",
      persistent,
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

export async function getYtMusicAuthStatus(): Promise<AuthStatusResult> {
  return buildAuthStatus();
}

export async function loginToYtMusic(parent: BrowserWindow | null): Promise<AuthStatusResult> {
  const loginWindow = new BrowserWindow({
    parent: parent ?? undefined,
    modal: !!parent,
    width: 1200,
    height: 860,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:muxics-ytmusic",
      sandbox: false,
    },
  });

  log("ytmusic", "info", "Opening YouTube Music sign-in window");

  const result = await new Promise<AuthStatusResult>((resolve) => {
    let settled = false;

    const finish = async () => {
      if (settled) {
        return;
      }

      settled = true;
      await persistCurrentYtMusicSession();
      cachedClient = null;
      resolve(await buildAuthStatus());
      if (!loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    };

    const checkLoginState = async () => {
      if (await hasYtMusicAuthCookies()) {
        await finish();
      }
    };

    const interval = setInterval(() => {
      void checkLoginState();
    }, 1500);

    loginWindow.on("closed", async () => {
      clearInterval(interval);
      if (!settled) {
        resolve(await buildAuthStatus());
      }
    });

    loginWindow.webContents.on("did-navigate", () => {
      void checkLoginState();
    });

    loginWindow.webContents.on("did-frame-finish-load", () => {
      void checkLoginState();
    });
  });

  await loginWindow.loadURL("https://music.youtube.com");
  return result;
}

export async function logoutFromYtMusic(): Promise<AuthStatusResult> {
  cachedClient = null;
  clearStoredYtMusicSession();
  await clearYtMusicCookies();
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
  const library = await client.music.getLibrary();

  const tracksFeed = library.filters.includes("Songs") ? await library.applyFilter("Songs") : library;
  const playlistFeed = library.filters.includes("Playlists") ? await library.applyFilter("Playlists") : library;

  const tracks = uniqueById(
    (await collectShelfItems(tracksFeed))
      .map((item) => toTrack(item))
      .filter((item): item is TrackResult => item != null),
  );

  const playlistSummaries = uniqueById(
    (await collectShelfItems(playlistFeed))
      .map((item) => toPlaylist(item))
      .filter((item): item is PlaylistResult => item != null),
  );

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

function chooseAudioFormat(format: Format): boolean {
  return format.has_audio && !format.has_video;
}

export async function getYtMusicPlayback(trackId: string, providerId: string): Promise<TrackPlaybackResult> {
  try {
    const client = await getClient();
    const format = await client.getStreamingData(providerId || trackId.replace(/^ytmusic:/, ""), {
      type: "audio",
      quality: "best",
      format: "any",
    });

    const url = format.url ?? (await format.decipher(client.session.player));
    if (!url || !chooseAudioFormat(format)) {
      return {
        mode: "unavailable",
        targetId: providerId,
        error: "No direct audio stream is available for this track.",
      };
    }

    return {
      mode: "direct",
      targetId: providerId,
      url,
      expiresAt: Date.now() + 1000 * 60 * 20,
      loudnessDb: format.loudness_db,
    };
  } catch (error) {
    log("ytmusic", "warn", "Failed to resolve playback", error);
    return {
      mode: "unavailable",
      targetId: providerId,
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
