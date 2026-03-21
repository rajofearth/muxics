import { create } from "zustand";
import type {
  AuthStatus,
  LibrarySource,
  PendingAuthLogin,
  Playlist,
  RepeatMode,
  Track,
} from "../types";
import { shuffleArray, parseTime } from "../utils";
import { showToast } from "../components/Toast";
import type {
  AuthLoginStartResult,
  DesktopBridge,
  PlaylistResult,
  TrackResult,
} from "../../shared/desktop-contract";

const CONCURRENCY = 10;
const MAX_RECENTLY_PLAYED = 50;
const YTM_REMOTE_SEARCH_DEBOUNCE_MS = 280;

let ytmSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let ytmSearchGeneration = 0;

function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i);
    h |= 0;
  }
  return `local:${Math.abs(h).toString(36)}:${p}`;
}

function mergeTracks(source: LibrarySource, localTracks: Track[], remoteTracks: Track[]): Track[] {
  if (source === "local") {
    return localTracks;
  }

  if (source === "ytmusic") {
    return remoteTracks;
  }

  return [...remoteTracks, ...localTracks];
}

function mergePlaylists(source: LibrarySource, localItems: Playlist[], remoteItems: Playlist[]): Playlist[] {
  if (source === "local") {
    return localItems;
  }

  if (source === "ytmusic") {
    return remoteItems;
  }

  return [...remoteItems, ...localItems];
}

function toTrack(track: TrackResult): Track {
  return {
    id: track.id,
    provider: track.provider,
    providerId: track.providerId,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    time: track.time,
    duration: track.duration,
    genre: track.genre,
    picture: track.picture,
    sourceLabel: track.sourceLabel,
    playback: track.playback,
  };
}

function toPlaylist(playlist: PlaylistResult): Playlist {
  const trackIdsFromEntries = playlist.entries.map((entry) => entry.id);
  const trackIdsFromTracks = (playlist.tracks ?? []).map((t) => t.id);
  const trackIds = trackIdsFromEntries.length > 0 ? trackIdsFromEntries : trackIdsFromTracks;

  return {
    id: playlist.id,
    provider: playlist.provider,
    providerId: playlist.providerId,
    name: playlist.name,
    path: playlist.path,
    trackIds,
    editable: playlist.editable,
    tracks: playlist.tracks?.map(toTrack),
    listedItemCount: playlist.listedItemCount,
  };
}

function ytTrackStubFromId(trackId: string): Track {
  const providerId = trackId.startsWith("ytmusic:") ? trackId.slice("ytmusic:".length) : trackId;
  return {
    id: trackId,
    provider: "ytmusic",
    providerId,
    title: "Loading track…",
    artist: "",
    album: "",
    time: "—",
    duration: 0,
    genre: "YouTube Music",
  };
}

function playlistNeedsYtDetailFetch(pl: Playlist): boolean {
  if (pl.provider !== "ytmusic") {
    return false;
  }

  const nTracks = pl.tracks?.length ?? 0;
  const nIds = pl.trackIds.length;
  const target = pl.listedItemCount ?? 0;

  const rich =
    pl.tracks?.some((t) => t.duration > 0 || Boolean(t.artist?.trim())) ?? false;

  if (nIds === 0 && nTracks === 0) {
    return target > 0;
  }

  if (!rich) {
    return true;
  }

  if (target > 0 && nTracks < target) {
    return true;
  }

  return false;
}

function mergeUniqueTracks(...groups: Track[][]): Track[] {
  const byId = new Map<string, Track>();
  for (const group of groups) {
    for (const track of group) {
      byId.set(track.id, track);
    }
  }
  return [...byId.values()];
}

function collectPlaylistTracks(playlists: Playlist[]): Track[] {
  const groups = playlists
    .map((playlist) => playlist.tracks ?? [])
    .filter((tracks) => tracks.length > 0);

  return groups.length > 0 ? mergeUniqueTracks(...groups) : [];
}

async function pLimit<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const res = await fn(items[i]);
      results[i] = res;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const defaultTheme = {
  accentColor: "#ff6b6b",
  palette: ["#ff6b6b", "#e55a5a", "#cc4c4c"],
};

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem("muxics-favorites");
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set();
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem("muxics-favorites", JSON.stringify([...favs]));
  } catch {}
}

function loadVolume(): number {
  try {
    const v = localStorage.getItem("muxics-volume");
    if (v !== null) return parseFloat(v);
  } catch {}
  return 0.75;
}

function loadThemeName(): string {
  try {
    return localStorage.getItem("muxics-theme") ?? "default";
  } catch {}
  return "default";
}

export interface PlayerState {
  rpc: DesktopBridge | null;
  auth: AuthStatus;
  authLogin: {
    pending: PendingAuthLogin | null;
    loading: boolean;
    error: string | null;
  };
  library: {
    tracks: Track[];
    localTracks: Track[];
    remoteTracks: Track[];
    loading: boolean;
    syncingRemote: boolean;
    error: string | null;
    scanProgress: number;
    source: LibrarySource;
    lastSyncedAt?: number;
  };
  playlists: {
    items: Playlist[];
    localItems: Playlist[];
    remoteItems: Playlist[];
    activeId: string | null;
    hydratingById: Record<string, boolean>;
    hydrationErrors: Record<string, string | null>;
  };
  player: {
    currentTrack: Track | null;
    queue: Track[];
    originalQueue: Track[];
    isPlaying: boolean;
    currentTime: number;
    volume: number;
    playbackUrl: string | null;
    shuffle: boolean;
    repeat: RepeatMode;
  };
  settings: { watchFolders: string[] };
  theme: { accentColor: string; palette: string[] };
  themeName: string;
  search: { query: string; results: Track[]; loading: boolean; error: string | null };
  recentlyPlayed: Track[];
  favorites: Set<string>;
}

interface PlayerActions {
  setRpc: (rpc: DesktopBridge | null) => void;
  loadAuthStatus: () => Promise<void>;
  loginToYtMusic: () => Promise<void>;
  importYtMusicSession: (cookie: string) => Promise<boolean>;
  completeYtMusicLogin: () => Promise<void>;
  cancelYtMusicLogin: () => Promise<void>;
  clearAuthLoginError: () => void;
  logoutFromYtMusic: () => Promise<void>;
  setLibrarySource: (source: LibrarySource) => void;
  loadLibrary: () => Promise<void>;
  hydrateYtMusicFromCache: () => Promise<void>;
  syncYtMusicLibrary: () => Promise<void>;
  loadCachedPlaylist: () => Promise<void>;
  ensurePlaylistHydrated: (playlistId: string) => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  playTrack: (track: Track, queue?: Track[] | null) => void;
  togglePlay: () => void;
  handleNext: () => void;
  handlePrev: () => void;
  setCurrentTime: (seconds: number) => void;
  setVolume: (value: number) => void;
  setPlaybackUrl: (url: string | null) => void;
  updateTheme: (accent: string, palette: string[]) => void;
  resetTheme: () => void;
  setThemeName: (name: string) => void;
  loadPlaylists: () => Promise<void>;
  setActivePlaylist: (id: string | null) => void;
  createPlaylist: (name: string) => Promise<void>;
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  loadPlaylistTracks: (playlistId: string) => Track[];
  getQueueFromLibrary: () => Track[];
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSearchQuery: (query: string) => Promise<void>;
  addToRecentlyPlayed: (track: Track) => void;
  toggleFavorite: (trackId: string) => Promise<void>;
  isFavorite: (trackId: string) => boolean;
  getFavoriteTracks: () => Track[];
  updateQueue: (newQueue: Track[]) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  rpc: null,
  auth: {
    loggedIn: false,
    provider: "ytmusic",
    persistent: false,
  },
  authLogin: {
    pending: null,
    loading: false,
    error: null,
  },
  library: {
    tracks: [],
    localTracks: [],
    remoteTracks: [],
    loading: false,
    syncingRemote: false,
    error: null,
    scanProgress: 0,
    source: "local",
  },
  playlists: {
    items: [],
    localItems: [],
    remoteItems: [],
    activeId: null,
    hydratingById: {},
    hydrationErrors: {},
  },
  player: {
    currentTrack: null,
    queue: [],
    originalQueue: [],
    isPlaying: false,
    currentTime: 0,
    volume: loadVolume(),
    playbackUrl: null,
    shuffle: false,
    repeat: "off",
  },
  settings: { watchFolders: [] },
  theme: defaultTheme,
  themeName: loadThemeName(),
  search: { query: "", results: [], loading: false, error: null },
  recentlyPlayed: [],
  favorites: loadFavorites(),

  setRpc: (rpc) => set({ rpc }),

  loadAuthStatus: async () => {
    const { rpc } = get();
    if (!rpc) return;

    const auth = await rpc.request.authGetStatus();
    set((s) => ({
      auth,
      authLogin: auth.loggedIn
        ? { pending: null, loading: false, error: null }
        : s.authLogin,
      library: {
        ...s.library,
        source: auth.loggedIn ? "ytmusic" : s.library.source,
        tracks: mergeTracks(auth.loggedIn ? "ytmusic" : s.library.source, s.library.localTracks, s.library.remoteTracks),
      },
    }));
  },

  loginToYtMusic: async () => {
    const { rpc } = get();
    if (!rpc) return;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result: AuthLoginStartResult = await rpc.request.authLogin();

    if (result.kind === "pending_verification") {
      set(() => ({
        authLogin: {
          pending: {
            verificationUrl: result.verificationUrl,
            userCode: result.userCode,
            expiresAt: result.expiresAt,
            pollIntervalMs: result.pollIntervalMs,
          },
          loading: false,
          error: null,
        },
      }));
      return;
    }

    if (result.kind === "completed" || result.kind === "already_logged_in") {
      const auth = result.auth;
      set({
        auth,
        authLogin: { pending: null, loading: false, error: null },
      });

      if (auth.loggedIn) {
        set((s) => ({
          library: { ...s.library, source: "ytmusic" },
        }));
        await get().hydrateYtMusicFromCache();
        void get().syncYtMusicLibrary();
      }
      return;
    }

    set(() => ({
      authLogin: { pending: null, loading: false, error: result.message },
    }));
  },

  importYtMusicSession: async (cookie) => {
    const { rpc } = get();
    if (!rpc) return false;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result = await rpc.request.authImportSession({ cookie });
    if (!result.success || !result.auth) {
      set((s) => ({
        authLogin: { ...s.authLogin, loading: false, error: result.error ?? "Failed to import YouTube Music session." },
      }));
      return false;
    }

    set((s) => ({
      auth: result.auth!,
      authLogin: { pending: null, loading: false, error: null },
      library: { ...s.library, source: "ytmusic" },
    }));

    await get().hydrateYtMusicFromCache();
    void get().syncYtMusicLibrary();
    return true;
  },

  completeYtMusicLogin: async () => {
    const { rpc, authLogin } = get();
    if (!rpc || !authLogin.pending) return;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result = await rpc.request.authCompleteLogin();
    if (result.kind === "completed") {
      set((s) => ({
        auth: result.auth,
        authLogin: { pending: null, loading: false, error: null },
        library: { ...s.library, source: "ytmusic" },
      }));
      await get().hydrateYtMusicFromCache();
      void get().syncYtMusicLibrary();
      return;
    }

    set((s) => ({
      authLogin: { pending: s.authLogin.pending, loading: false, error: result.message },
    }));
  },

  cancelYtMusicLogin: async () => {
    const { rpc } = get();
    if (!rpc) return;

    await rpc.request.authCancelLogin();
    set(() => ({
      authLogin: { pending: null, loading: false, error: null },
    }));
  },

  clearAuthLoginError: () => {
    set((s) => ({
      authLogin: { ...s.authLogin, error: null },
    }));
  },

  logoutFromYtMusic: async () => {
    const { rpc } = get();
    if (!rpc) return;

    const auth = await rpc.request.authLogout();
    set((s) => ({
      auth,
      authLogin: { pending: null, loading: false, error: null },
      library: {
        ...s.library,
        remoteTracks: [],
        tracks: mergeTracks("local", s.library.localTracks, []),
        source: "local",
      },
      playlists: {
        ...s.playlists,
        remoteItems: [],
        items: mergePlaylists("local", s.playlists.localItems, []),
        hydratingById: {},
        hydrationErrors: {},
      },
    }));
  },

  setLibrarySource: (source) =>
    set((s) => ({
      library: {
        ...s.library,
        source,
        tracks: mergeTracks(source, s.library.localTracks, s.library.remoteTracks),
      },
      playlists: {
        ...s.playlists,
        items: mergePlaylists(source, s.playlists.localItems, s.playlists.remoteItems),
      },
    })),

  loadLibrary: async () => {
    const { rpc } = get();
    if (!rpc) return;

    set((s) => ({
      library: { ...s.library, loading: true, error: null, scanProgress: 0 },
    }));

    try {
      let folders = await rpc.request.getWatchFolders();
      if (folders.length === 0) {
        const defaultPath = await rpc.request.getDefaultMusicPath();
        const addResult = await rpc.request.addFolder({ path: defaultPath });
        if (!addResult.success) {
          set((s) => ({
            library: {
              ...s.library,
              localTracks: [],
              tracks: mergeTracks(s.library.source, [], s.library.remoteTracks),
              loading: false,
              error: addResult.error ?? "Could not add folder",
              scanProgress: 0,
            },
            settings: { watchFolders: [] },
          }));
          return;
        }
        folders = await rpc.request.getWatchFolders();
      }

      const { files } = await rpc.request.scanFolders({ paths: folders });
      let completed = 0;

      const results = await pLimit(files, async (f) => {
        const meta = await rpc.request.getTrackMetadata({ path: f.path });
        completed++;
        if (completed % 10 === 0 || completed === files.length) {
          set((s) => ({
            library: {
              ...s.library,
              scanProgress: files.length === 0 ? 100 : Math.round((completed / files.length) * 100),
            },
          }));
        }
        if (!meta) return null;
        return {
          id: hashPath(f.path),
          provider: "local" as const,
          providerId: f.path,
          path: f.path,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          time: meta.time,
          duration: meta.duration || parseTime(meta.time),
          genre: meta.genre,
          picture: meta.picture,
          sourceLabel: "Local Files",
        } as Track;
      });

      const localTracks = results.filter((t): t is Track => t != null);

      set((s) => ({
        library: {
          ...s.library,
          localTracks,
          tracks: mergeTracks(s.library.source, localTracks, s.library.remoteTracks),
          loading: false,
          error: null,
          scanProgress: 100,
        },
        settings: { watchFolders: folders },
      }));
    } catch (err) {
      set((s) => ({
        library: {
          ...s.library,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load library",
          scanProgress: 0,
        },
      }));
    }
  },

  hydrateYtMusicFromCache: async () => {
    const { rpc, auth } = get();
    if (!rpc || !auth.loggedIn) return;

    let useDisk = true;
    try {
      const desktopSettings = await rpc.request.getSettings();
      useDisk = desktopSettings.ytmusicUseLibraryDiskCache !== false;
    } catch {
      useDisk = true;
    }
    if (!useDisk) return;

    const cached = await rpc.request.ytmusicLoadCachedLibrary();
    if (!cached) return;

    const remoteItems = cached.playlists.map(toPlaylist);
    const remoteTracks = mergeUniqueTracks(
      cached.tracks.map(toTrack),
      collectPlaylistTracks(remoteItems),
    );

    set((s) => ({
      auth: {
        ...s.auth,
        lastSyncedAt: cached.lastSyncedAt || s.auth.lastSyncedAt,
      },
      library: {
        ...s.library,
        remoteTracks,
        tracks: mergeTracks(s.library.source, s.library.localTracks, remoteTracks),
        lastSyncedAt: cached.lastSyncedAt ?? s.library.lastSyncedAt,
      },
      playlists: {
        ...s.playlists,
        remoteItems,
        items: mergePlaylists(s.library.source, s.playlists.localItems, remoteItems),
      },
    }));

    void get().loadCachedPlaylist();
  },

  syncYtMusicLibrary: async () => {
    const { rpc, auth } = get();
    if (!rpc || !auth.loggedIn) return;

    set((s) => ({
      library: { ...s.library, syncingRemote: true, error: null },
    }));

    try {
      const synced = await rpc.request.ytmusicSyncLibrary();
      const remoteItems = synced.playlists.map(toPlaylist);
      const remoteTracks = mergeUniqueTracks(
        synced.tracks.map(toTrack),
        collectPlaylistTracks(remoteItems),
      );

      set((s) => ({
        auth: { ...s.auth, lastSyncedAt: synced.lastSyncedAt },
        library: {
          ...s.library,
          remoteTracks,
          tracks: mergeTracks(s.library.source, s.library.localTracks, remoteTracks),
          syncingRemote: false,
          lastSyncedAt: synced.lastSyncedAt,
        },
        playlists: {
          ...s.playlists,
          remoteItems,
          items: mergePlaylists(s.library.source, s.playlists.localItems, remoteItems),
        },
      }));

      void get().loadCachedPlaylist();
    } catch (error) {
      set((s) => ({
        library: {
          ...s.library,
          syncingRemote: false,
          error: error instanceof Error ? error.message : "Failed to sync YouTube Music.",
        },
      }));
    }
  },

  loadCachedPlaylist: async () => {
    const { rpc, library, recentlyPlayed } = get();
    if (!rpc) return;

    try {
      const cachedTrackIds = await rpc.request.getFullyCachedTrackIds();
      if (!cachedTrackIds) return;

      const allKnownTracks = Object.values(
        [...library.tracks, ...recentlyPlayed].reduce((acc, t) => {
          acc[t.id] = t;
          return acc;
        }, {} as Record<string, Track>)
      );

      const cachedTracks = allKnownTracks.filter((t) => cachedTrackIds.includes(t.providerId));

      const cachedPlaylist: Playlist = {
        id: "ytmusic-cached",
        provider: "ytmusic",
        providerId: "ytmusic-cached",
        name: "Cached",
        path: "ytmusic-cached",
        editable: false,
        trackIds: cachedTracks.map((t) => t.id),
        tracks: cachedTracks,
      };

      set((s) => {
        const withoutCached = s.playlists.remoteItems.filter((p) => p.id !== "ytmusic-cached");
        const nextRemoteItems = [cachedPlaylist, ...withoutCached];
        return {
          playlists: {
            ...s.playlists,
            remoteItems: nextRemoteItems,
            items: mergePlaylists(s.library.source, s.playlists.localItems, nextRemoteItems),
          },
        };
      });
    } catch {}
  },

  ensurePlaylistHydrated: async (playlistId) => {
    const { rpc, playlists } = get();
    if (!rpc) return;

    const playlist = playlists.items.find((item) => item.id === playlistId);
    if (!playlist || !playlistNeedsYtDetailFetch(playlist)) {
      return;
    }

    if (playlists.hydratingById[playlistId]) {
      return;
    }

    set((s) => ({
      playlists: {
        ...s.playlists,
        hydratingById: { ...s.playlists.hydratingById, [playlistId]: true },
        hydrationErrors: { ...s.playlists.hydrationErrors, [playlistId]: null },
      },
    }));

    try {
      const detailed = await rpc.request.ytmusicGetPlaylist({ playlistId: playlist.providerId });
      if (!detailed) {
        throw new Error("Playlist tracks could not be loaded from YouTube Music.");
      }

      const updated = toPlaylist(detailed);
      set((s) => {
        const remoteItems = s.playlists.remoteItems.map((item) =>
          item.id === updated.id ? updated : item,
        );
        const remoteTracks = mergeUniqueTracks(s.library.remoteTracks, collectPlaylistTracks(remoteItems));

        return {
          library: {
            ...s.library,
            remoteTracks,
            tracks: mergeTracks(s.library.source, s.library.localTracks, remoteTracks),
          },
          playlists: {
            ...s.playlists,
            remoteItems,
            items: mergePlaylists(s.library.source, s.playlists.localItems, remoteItems),
            hydratingById: { ...s.playlists.hydratingById, [playlistId]: false },
            hydrationErrors: { ...s.playlists.hydrationErrors, [playlistId]: null },
          },
        };
      });
    } catch (error) {
      set((s) => ({
        playlists: {
          ...s.playlists,
          hydratingById: { ...s.playlists.hydratingById, [playlistId]: false },
          hydrationErrors: {
            ...s.playlists.hydrationErrors,
            [playlistId]:
              error instanceof Error ? error.message : "Failed to load YouTube Music playlist.",
          },
        },
      }));
    }
  },

  addFolder: async (folderPath) => {
    const { rpc } = get();
    if (!rpc) {
      set((s) => ({
        library: { ...s.library, error: "App not ready. Please try again." },
      }));
      return;
    }

    const result = await rpc.request.addFolder({ path: folderPath });
    if (!result.success) {
      const msg = result.error ?? "Failed to add folder";
      set((s) => ({ library: { ...s.library, loading: false, error: msg } }));
      return;
    }

    const folders = await rpc.request.getWatchFolders();
    set((s) => ({
      settings: { watchFolders: folders },
      library: { ...s.library, error: null },
    }));
    await get().loadLibrary();
  },

  removeFolder: async (folderPath) => {
    const { rpc } = get();
    if (!rpc) return;

    await rpc.request.removeFolder({ path: folderPath });
    const sep = folderPath.includes("\\") ? "\\" : "/";
    const prefix = folderPath.endsWith(sep) ? folderPath : `${folderPath}${sep}`;

    set((s) => {
      const localTracks = s.library.localTracks.filter((t) => !t.path?.startsWith(prefix));
      return {
        settings: {
          watchFolders: s.settings.watchFolders.filter((p) => p !== folderPath),
        },
        library: {
          ...s.library,
          localTracks,
          tracks: mergeTracks(s.library.source, localTracks, s.library.remoteTracks),
          loading: false,
          error: null,
        },
      };
    });
  },

  playTrack: (track, queue = null) => {
    const state = get();
    const q = queue ?? state.player.queue;
    state.addToRecentlyPlayed(track);

    set({
      player: {
        ...state.player,
        currentTrack: track,
        queue: state.player.shuffle && queue ? shuffleArray(q) : q,
        originalQueue: queue ?? state.player.originalQueue,
        isPlaying: true,
        currentTime: 0,
      },
    });
  },

  togglePlay: () =>
    set((s) => ({ player: { ...s.player, isPlaying: !s.player.isPlaying } })),

  handleNext: () => {
    const { queue, currentTrack, repeat } = get().player;
    if (queue.length === 0) return;

    if (repeat === "one") {
      set((s) => ({ player: { ...s.player, currentTime: 0 } }));
      return;
    }

    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    if (idx >= 0 && idx < queue.length - 1) {
      get().playTrack(queue[idx + 1]);
    } else if (repeat === "all") {
      get().playTrack(queue[0]);
    } else if (idx === queue.length - 1) {
      set((s) => ({
        player: { ...s.player, isPlaying: false, currentTime: 0 },
      }));
    }
  },

  handlePrev: () => {
    const { queue, currentTrack, currentTime } = get().player;
    if (queue.length === 0) return;

    if (currentTime > 3 && currentTrack) {
      document.dispatchEvent(new CustomEvent("player-seek", { detail: 0 }));
      set((s) => ({ player: { ...s.player, currentTime: 0 } }));
      return;
    }

    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    const prev = idx > 0 ? queue[idx - 1] : queue[queue.length - 1];
    if (prev) get().playTrack(prev);
  },

  setCurrentTime: (seconds) =>
    set((s) => ({ player: { ...s.player, currentTime: seconds } })),

  setVolume: (value) => {
    const v = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem("muxics-volume", String(v));
    } catch {}
    set((s) => ({ player: { ...s.player, volume: v } }));
  },

  setPlaybackUrl: (url) =>
    set((s) => ({ player: { ...s.player, playbackUrl: url } })),

  updateTheme: (accentColor, palette) =>
    set({ theme: { accentColor, palette } }),

  resetTheme: () => set({ theme: defaultTheme }),

  setThemeName: (name) => {
    try { localStorage.setItem("muxics-theme", name); } catch {}
    set({ themeName: name });
  },

  loadPlaylists: async () => {
    const { rpc, library } = get();
    if (!rpc) return;

    const localList = await rpc.request.listPlaylists();
    const localItems = localList.map(toPlaylist);

    set((s) => ({
      playlists: {
        ...s.playlists,
        localItems,
        items: mergePlaylists(library.source, localItems, s.playlists.remoteItems),
      },
    }));
  },

  setActivePlaylist: (id) =>
    set((s) => ({ playlists: { ...s.playlists, activeId: id } })),

  createPlaylist: async (name) => {
    const { rpc, library } = get();
    if (!rpc) return;

    if (library.source === "ytmusic") {
      await rpc.request.ytmusicCreatePlaylist({ name });
      await get().syncYtMusicLibrary();
      return;
    }

    const dir = await rpc.request.getPlaylistsDir();
    await rpc.request.savePlaylist({ path: dir, name, entries: [] });
    await get().loadPlaylists();
  },

  renamePlaylist: async (playlistId, newName) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;

    if (pl.provider === "ytmusic") {
      await rpc.request.ytmusicRenamePlaylist({
        playlistId: pl.providerId,
        name: newName.trim(),
      });
      await get().syncYtMusicLibrary();
      return;
    }

    await rpc.request.renamePlaylist({
      oldPath: pl.path ?? pl.providerId,
      newName: newName.trim(),
    });
    await get().loadPlaylists();
  },

  deletePlaylist: async (playlistId) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;

    if (pl.provider === "ytmusic") {
      await rpc.request.ytmusicDeletePlaylist({ playlistId: pl.providerId });
      await get().syncYtMusicLibrary();
      return;
    }

    if (pl.path) {
      await rpc.request.deletePlaylist({ path: pl.path });
      await get().loadPlaylists();
    }
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;

    if (pl.provider !== track.provider) {
      showToast(
        `Cannot add a ${track.provider} track to a ${pl.provider} playlist.`,
        "error",
      );
      return;
    }

    if (pl.provider === "ytmusic") {
      await rpc.request.ytmusicAddTrackToPlaylist({
        playlistId: pl.providerId,
        videoId: track.providerId,
      });
      const detailed = await rpc.request.ytmusicGetPlaylist({ playlistId: pl.providerId });
      if (detailed) {
        const updated = toPlaylist(detailed);
        set((s) => {
          const remoteItems = s.playlists.remoteItems.map((item) =>
            item.id === updated.id ? updated : item,
          );
          const remoteTracks = mergeUniqueTracks(
            s.library.remoteTracks,
            collectPlaylistTracks(remoteItems),
          );
          return {
            library: {
              ...s.library,
              remoteTracks,
              tracks: mergeTracks(s.library.source, s.library.localTracks, remoteTracks),
            },
            playlists: {
              ...s.playlists,
              remoteItems,
              items: mergePlaylists(s.library.source, s.playlists.localItems, remoteItems),
            },
          };
        });
      }
      return;
    }

    const entries = [...pl.trackIds, track.id]
      .map((id) => get().library.localTracks.find((localTrack) => localTrack.id === id)?.path)
      .filter((value): value is string => Boolean(value));
    const dir = (pl.path ?? "").replace(/[/\\][^/\\]+$/, "");
    const name = pl.name.replace(/\.m3u8?$/, "");
    await rpc.request.savePlaylist({ path: dir, name, entries });
    await get().loadPlaylists();
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;

    if (pl.provider === "ytmusic") {
      const track = get().library.remoteTracks.find((item) => item.id === trackId);
      if (!track) return;
      await rpc.request.ytmusicRemoveTrackFromPlaylist({
        playlistId: pl.providerId,
        videoId: track.providerId,
      });
      const detailed = await rpc.request.ytmusicGetPlaylist({ playlistId: pl.providerId });
      if (detailed) {
        const updated = toPlaylist(detailed);
        set((s) => {
          const remoteItems = s.playlists.remoteItems.map((item) =>
            item.id === updated.id ? updated : item,
          );
          const remoteTracks = mergeUniqueTracks(
            s.library.remoteTracks,
            collectPlaylistTracks(remoteItems),
          );
          return {
            library: {
              ...s.library,
              remoteTracks,
              tracks: mergeTracks(s.library.source, s.library.localTracks, remoteTracks),
            },
            playlists: {
              ...s.playlists,
              remoteItems,
              items: mergePlaylists(s.library.source, s.playlists.localItems, remoteItems),
            },
          };
        });
      }
      return;
    }

    const entries = pl.trackIds
      .filter((id) => id !== trackId)
      .map((id) => get().library.localTracks.find((localTrack) => localTrack.id === id)?.path)
      .filter((value): value is string => Boolean(value));
    const dir = (pl.path ?? "").replace(/[/\\][^/\\]+$/, "");
    const name = pl.name.replace(/\.m3u8?$/, "");
    await rpc.request.savePlaylist({ path: dir, name, entries });
    await get().loadPlaylists();
  },

  loadPlaylistTracks: (playlistId) => {
    const { playlists, library } = get();
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return [];

    if (pl.tracks && pl.tracks.length > 0) {
      return pl.tracks;
    }

    const trackMap = new Map([...library.localTracks, ...library.remoteTracks].map((track) => [track.id, track]));
    const fromLibrary = pl.trackIds.map((id) => trackMap.get(id)).filter((t): t is Track => t != null);
    if (fromLibrary.length > 0) {
      return fromLibrary;
    }

    if (pl.provider === "ytmusic" && playlists.hydrationErrors[playlistId] && !pl.tracks?.length) {
      return [];
    }

    if (pl.provider === "ytmusic" && pl.trackIds.length > 0) {
      return pl.trackIds.map((id) => ytTrackStubFromId(id));
    }

    return [];
  },

  getQueueFromLibrary: () => get().library.tracks,

  toggleShuffle: () => {
    const { player } = get();
    const newShuffle = !player.shuffle;
    if (newShuffle) {
      const current = player.currentTrack;
      const rest = player.queue.filter((t) => t.id !== current?.id);
      const shuffled = current ? [current, ...shuffleArray(rest)] : shuffleArray(player.queue);
      set((s) => ({
        player: {
          ...s.player,
          shuffle: true,
          originalQueue: s.player.queue,
          queue: shuffled,
        },
      }));
    } else {
      set((s) => ({
        player: {
          ...s.player,
          shuffle: false,
          queue: s.player.originalQueue,
        },
      }));
    }
  },

  cycleRepeat: () => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const current = get().player.repeat;
    const idx = modes.indexOf(current);
    set((s) => ({
      player: { ...s.player, repeat: modes[(idx + 1) % modes.length] },
    }));
  },

  setSearchQuery: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      if (ytmSearchDebounceTimer) {
        clearTimeout(ytmSearchDebounceTimer);
        ytmSearchDebounceTimer = null;
      }
      ytmSearchGeneration += 1;
      set({ search: { query: "", results: [], loading: false, error: null } });
      return;
    }

    const { library, rpc, auth } = get();
    const q = trimmed.toLowerCase();
    const localResults = mergeTracks(library.source, library.localTracks, []).filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q),
    );

    const needsRemote = Boolean(rpc && auth.loggedIn && library.source !== "local");

    if (!needsRemote) {
      if (ytmSearchDebounceTimer) {
        clearTimeout(ytmSearchDebounceTimer);
        ytmSearchDebounceTimer = null;
      }
      set({ search: { query: trimmed, results: localResults, loading: false, error: null } });
      return;
    }

    set({ search: { query: trimmed, results: localResults, loading: true, error: null } });

    if (ytmSearchDebounceTimer) {
      clearTimeout(ytmSearchDebounceTimer);
      ytmSearchDebounceTimer = null;
    }

    const generation = ++ytmSearchGeneration;
    ytmSearchDebounceTimer = setTimeout(() => {
      ytmSearchDebounceTimer = null;
      void (async () => {
        if (generation !== ytmSearchGeneration) {
          return;
        }
        const st = get();
        if (st.search.query.trim() !== trimmed) {
          return;
        }
        const { rpc: rpcNow, auth: authNow, library: libNow } = st;
        if (!rpcNow || !authNow.loggedIn || libNow.source === "local") {
          return;
        }

        const localAgain = mergeTracks(libNow.source, libNow.localTracks, []).filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q),
        );

        try {
          const remoteResults = await rpcNow.request.ytmusicSearch({ query: trimmed });
          if (generation !== ytmSearchGeneration || get().search.query.trim() !== trimmed) {
            return;
          }
          const normalized = remoteResults.map(toTrack);
          const combined =
            libNow.source === "all"
              ? [...normalized, ...localAgain].filter(
                  (track, index, list) => list.findIndex((entry) => entry.id === track.id) === index,
                )
              : normalized;
          set({ search: { query: trimmed, results: combined, loading: false, error: null } });
        } catch (error) {
          if (generation !== ytmSearchGeneration || get().search.query.trim() !== trimmed) {
            return;
          }
          set({
            search: {
              query: trimmed,
              results: localAgain,
              loading: false,
              error: error instanceof Error ? error.message : "Search failed.",
            },
          });
        }
      })();
    }, YTM_REMOTE_SEARCH_DEBOUNCE_MS);
  },

  addToRecentlyPlayed: (track) => {
    set((s) => {
      const filtered = s.recentlyPlayed.filter((t) => t.id !== track.id);
      return {
        recentlyPlayed: [track, ...filtered].slice(0, MAX_RECENTLY_PLAYED),
      };
    });
  },

  toggleFavorite: async (trackId) => {
    const { rpc, library } = get();
    const track = [...library.localTracks, ...library.remoteTracks].find((item) => item.id === trackId);
    const previousFavorites = new Set(get().favorites);

    set((s) => {
      const next = new Set(s.favorites);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      saveFavorites(next);
      return { favorites: next };
    });

    if (!rpc || !track || track.provider !== "ytmusic") {
      return;
    }

    try {
      if (get().favorites.has(trackId)) {
        await rpc.request.ytmusicLike({ videoId: track.providerId });
      } else {
        await rpc.request.ytmusicUnlike({ videoId: track.providerId });
      }
    } catch (err) {
      set({ favorites: previousFavorites });
      saveFavorites(previousFavorites);
      showToast(
        err instanceof Error ? `Failed to update favorites: ${err.message}` : "Failed to update favorites",
        "error",
      );
      throw err;
    }
  },

  isFavorite: (trackId) => get().favorites.has(trackId),

  getFavoriteTracks: () => {
    const { library, favorites } = get();
    return [...library.localTracks, ...library.remoteTracks].filter((t) => favorites.has(t.id));
  },

  updateQueue: (newQueue) => {
    set((s) => ({
      player: { ...s.player, queue: newQueue, originalQueue: newQueue },
    }));
  },

  playNext: (track) => {
    const { player } = get();
    const queue = [...player.queue];
    const idx = queue.findIndex((t) => t.id === player.currentTrack?.id);
    if (idx >= 0) {
      queue.splice(idx + 1, 0, track);
    } else {
      queue.unshift(track);
    }
    if (!player.currentTrack) {
      get().playTrack(track, queue);
    } else {
      set((s) => ({ player: { ...s.player, queue, originalQueue: queue } }));
    }
  },

  addToQueue: (track) => {
    const { player } = get();
    const queue = [...player.queue, track];
    if (!player.currentTrack) {
      get().playTrack(track, queue);
    } else {
      set((s) => ({ player: { ...s.player, queue, originalQueue: queue } }));
    }
  },
}));
