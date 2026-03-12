import { create } from "zustand";
import type { Track, Playlist, RepeatMode } from "../types";
import { shuffleArray, parseTime } from "../utils";
import type { DesktopBridge } from "../../shared/desktop-contract";

const CONCURRENCY = 10;

function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i);
    h |= 0;
  }
  return `t_${Math.abs(h).toString(36)}`;
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

interface PlayerState {
  rpc: DesktopBridge | null;
  library: { tracks: Track[]; loading: boolean; error: string | null; scanProgress: number };
  playlists: { items: Playlist[]; activeId: string | null };
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
  search: { query: string; results: Track[] };
  recentlyPlayed: Track[];
  favorites: Set<string>;
}

interface PlayerActions {
  setRpc: (rpc: DesktopBridge | null) => void;
  loadLibrary: () => Promise<void>;
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
  loadPlaylists: () => Promise<void>;
  setActivePlaylist: (id: string | null) => void;
  createPlaylist: (name: string) => Promise<void>;
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackPath: string) => Promise<void>;
  loadPlaylistTracks: (playlistId: string) => Track[];
  getQueueFromLibrary: () => Track[];
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSearchQuery: (query: string) => void;
  addToRecentlyPlayed: (track: Track) => void;
  toggleFavorite: (trackId: string) => void;
  isFavorite: (trackId: string) => boolean;
  getFavoriteTracks: () => Track[];
  updateQueue: (newQueue: Track[]) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
}

const defaultTheme = { accentColor: "#ff6b6b", palette: ["#ff6b6b", "#e55a5a", "#cc4c4c"] };

const MAX_RECENTLY_PLAYED = 50;

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem("muse-favorites");
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set();
}

function saveFavorites(favs: Set<string>) {
  try { localStorage.setItem("muse-favorites", JSON.stringify([...favs])); } catch {}
}

function loadVolume(): number {
  try {
    const v = localStorage.getItem("muse-volume");
    if (v !== null) return parseFloat(v);
  } catch {}
  return 0.75;
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  rpc: null,

  library: { tracks: [], loading: false, error: null, scanProgress: 0 },
  playlists: { items: [], activeId: null },
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
  search: { query: "", results: [] },
  recentlyPlayed: [],
  favorites: loadFavorites(),

  setRpc: (rpc) => set({ rpc }),

  loadLibrary: async () => {
    const { rpc } = get();
    if (!rpc) return;

    set((s) => ({ library: { ...s.library, loading: true, error: null, scanProgress: 0 } }));

    try {
      let folders = await rpc.request.getWatchFolders();
      if (folders.length === 0) {
        const defaultPath = await rpc.request.getDefaultMusicPath();
        const addResult = await rpc.request.addFolder({ path: defaultPath });
        if (!addResult.success) {
          set({
            library: { tracks: [], loading: false, error: addResult.error ?? "Could not add folder", scanProgress: 0 },
            settings: { watchFolders: [] },
          });
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
          set((s) => ({ library: { ...s.library, scanProgress: Math.round((completed / files.length) * 100) } }));
        }
        if (!meta) return null;
        return {
          id: hashPath(f.path),
          path: f.path,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          time: meta.time,
          duration: meta.duration || parseTime(meta.time),
          genre: meta.genre,
          picture: meta.picture,
        } as Track;
      });

      const tracks = results.filter((t): t is Track => t != null);

      set({
        library: { tracks, loading: false, error: null, scanProgress: 100 },
        settings: { watchFolders: folders },
      });
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

  addFolder: async (folderPath) => {
    const { rpc } = get();
    if (!rpc) {
      set((s) => ({ library: { ...s.library, error: "App not ready. Please try again." } }));
      return;
    }

    const result = await rpc.request.addFolder({ path: folderPath });
    if (!result.success) {
      const msg = result.error ?? "Failed to add folder";
      set((s) => ({ library: { ...s.library, loading: false, error: msg } }));
      return;
    }

    const folders = await rpc.request.getWatchFolders();
    set((s) => ({ settings: { watchFolders: folders }, library: { ...s.library, error: null } }));
    await get().loadLibrary();
  },

  removeFolder: async (folderPath) => {
    const { rpc } = get();
    if (!rpc) return;

    await rpc.request.removeFolder({ path: folderPath });
    const sep = folderPath.includes("\\") ? "\\" : "/";
    const prefix = folderPath.endsWith(sep) ? folderPath : folderPath + sep;
    set((s) => ({
      settings: { watchFolders: s.settings.watchFolders.filter((p) => p !== folderPath) },
      library: { tracks: s.library.tracks.filter((t) => !t.path.startsWith(prefix)), loading: false, error: null, scanProgress: s.library.scanProgress },
    }));
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

  togglePlay: () => set((s) => ({ player: { ...s.player, isPlaying: !s.player.isPlaying } })),

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
      set((s) => ({ player: { ...s.player, isPlaying: false, currentTime: 0 } }));
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
    try { localStorage.setItem("muse-volume", String(v)); } catch {}
    set((s) => ({ player: { ...s.player, volume: v } }));
  },

  setPlaybackUrl: (url) => set((s) => ({ player: { ...s.player, playbackUrl: url } })),

  updateTheme: (accentColor, palette) => set({ theme: { accentColor, palette } }),

  resetTheme: () => set({ theme: defaultTheme }),

  loadPlaylists: async () => {
    const { rpc } = get();
    if (!rpc) return;

    const list = await rpc.request.listPlaylists();
    const items: Playlist[] = list.map((pl, i) => ({
      id: `pl_${i}_${pl.path}`,
      name: pl.name,
      path: pl.path,
      trackIds: pl.entries.map((e) => e.path),
    }));
    set((s) => ({ playlists: { ...s.playlists, items } }));
  },

  setActivePlaylist: (id) => set((s) => ({ playlists: { ...s.playlists, activeId: id } })),

  createPlaylist: async (name) => {
    const { rpc } = get();
    if (!rpc) return;
    const dir = await rpc.request.getPlaylistsDir();
    await rpc.request.savePlaylist({ path: dir, name, entries: [] });
    await get().loadPlaylists();
  },

  renamePlaylist: async (playlistId, newName) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;
    await rpc.request.renamePlaylist({ oldPath: pl.path, newName: newName.trim() });
    await get().loadPlaylists();
  },

  deletePlaylist: async (playlistId) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;
    await rpc.request.deletePlaylist({ path: pl.path });
    await get().loadPlaylists();
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;
    const entries = [...pl.trackIds, track.path];
    const dir = pl.path.replace(/[/\\][^/\\]+$/, "");
    const name = pl.name.replace(/\.m3u8?$/, "");
    await rpc.request.savePlaylist({ path: dir, name, entries });
    await get().loadPlaylists();
  },

  removeTrackFromPlaylist: async (playlistId, trackPath) => {
    const { rpc, playlists } = get();
    if (!rpc) return;
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return;
    const entries = pl.trackIds.filter((p) => p !== trackPath);
    const dir = pl.path.replace(/[/\\][^/\\]+$/, "");
    const name = pl.name.replace(/\.m3u8?$/, "");
    await rpc.request.savePlaylist({ path: dir, name, entries });
    await get().loadPlaylists();
  },

  loadPlaylistTracks: (playlistId) => {
    const { playlists, library } = get();
    const pl = playlists.items.find((p) => p.id === playlistId);
    if (!pl) return [];
    const pathMap = new Map(library.tracks.map((t) => [t.path, t]));
    return pl.trackIds.map((p) => pathMap.get(p)).filter((t): t is Track => t != null);
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
        player: { ...s.player, shuffle: true, originalQueue: s.player.queue, queue: shuffled },
      }));
    } else {
      set((s) => ({
        player: { ...s.player, shuffle: false, queue: s.player.originalQueue },
      }));
    }
  },

  cycleRepeat: () => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const current = get().player.repeat;
    const idx = modes.indexOf(current);
    set((s) => ({ player: { ...s.player, repeat: modes[(idx + 1) % modes.length] } }));
  },

  setSearchQuery: (query) => {
    const { library } = get();
    if (!query.trim()) {
      set({ search: { query: "", results: [] } });
      return;
    }
    const q = query.toLowerCase();
    const results = library.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
    set({ search: { query, results } });
  },

  addToRecentlyPlayed: (track) => {
    set((s) => {
      const filtered = s.recentlyPlayed.filter((t) => t.id !== track.id);
      return { recentlyPlayed: [track, ...filtered].slice(0, MAX_RECENTLY_PLAYED) };
    });
  },

  toggleFavorite: (trackId) => {
    set((s) => {
      const next = new Set(s.favorites);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      saveFavorites(next);
      return { favorites: next };
    });
  },

  isFavorite: (trackId) => get().favorites.has(trackId),

  getFavoriteTracks: () => {
    const { library, favorites } = get();
    return library.tracks.filter((t) => favorites.has(t.id));
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
