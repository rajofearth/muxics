import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Playlist, RecentPlay, RepeatMode, Track } from "../types";
import { mapTrackPaths, resolveNextTrack, resolvePreviousTrack } from "./playback";

function hashPath(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = (hash << 5) - hash + filePath.charCodeAt(i);
    hash |= 0;
  }
  return `t_${Math.abs(hash).toString(36)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pushRecentPlay(recentPlays: RecentPlay[], path: string): RecentPlay[] {
  return [{ path, playedAt: Date.now() }, ...recentPlays.filter((entry) => entry.path !== path)].slice(
    0,
    100
  );
}

function buildSession(player: PlayerState["player"]) {
  return {
    currentTrackPath: player.currentTrack?.path ?? null,
    queuePaths: player.queue.map((track) => track.path),
    currentTime: player.currentTime,
  };
}

type PlayTrackOptions = {
  autoplay?: boolean;
  recordRecent?: boolean;
  skipSessionHistory?: boolean;
  startTime?: number;
};

export type WinampRPC = {
  request: {
    getDefaultMusicPath: () => Promise<string>;
    scanLibrary: (p: { paths: string[] }) => Promise<{
      tracks: {
        path: string;
        title: string;
        artist: string;
        album: string;
        duration: number;
        time: string;
        genre: string;
        picture?: string;
      }[];
    }>;
    getPlaybackUrl: (p: { path: string }) => Promise<string>;
    getWatchFolders: () => Promise<string[]>;
    addFolder: (p: { path: string }) => Promise<{ success: boolean; error?: string }>;
    validateFolder: (p: { path: string }) => Promise<{
      valid: boolean;
      resolvedPath?: string;
      error?: string;
    }>;
    removeFolder: (p: { path: string }) => Promise<void>;
    savePlaylist: (p: { path: string; name: string; entries: string[] }) => Promise<void>;
    listPlaylists: () => Promise<{
      name: string;
      path: string;
      entries: { path: string; title?: string }[];
    }[]>;
    getPlaylistsDir: () => Promise<string>;
    renamePlaylist: (p: { oldPath: string; newName: string }) => Promise<void>;
    deletePlaylist: (p: { path: string }) => Promise<void>;
    importPlaylist: (p: { path: string }) => Promise<boolean>;
    exportPlaylist: (p: { name: string; entries: string[] }) => Promise<string>;
  };
};

interface PlayerState {
  rpc: WinampRPC | null;
  library: { tracks: Track[]; loading: boolean; error: string | null };
  playlists: { items: Playlist[]; activeId: string | null };
  player: {
    currentTrack: Track | null;
    queue: Track[];
    isPlaying: boolean;
    currentTime: number;
    volume: number;
    playbackUrl: string | null;
    shuffleEnabled: boolean;
    repeatMode: RepeatMode;
    sessionHistoryPaths: string[];
  };
  preferences: {
    likedTrackPaths: string[];
    recentPlays: RecentPlay[];
    session: {
      currentTrackPath: string | null;
      queuePaths: string[];
      currentTime: number;
    };
  };
  settings: { watchFolders: string[] };
  theme: { accentColor: string; palette: string[] };
}

interface PlayerActions {
  setRpc: (rpc: WinampRPC | null) => void;
  loadLibrary: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  playTrack: (track: Track, queue?: Track[] | null, options?: PlayTrackOptions) => void;
  togglePlay: () => void;
  handleNext: () => void;
  handlePrev: () => void;
  handleTrackEnd: () => void;
  setCurrentTime: (seconds: number) => void;
  setVolume: (value: number) => void;
  setPlaybackUrl: (url: string | null) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  toggleLikedTrack: (track: Track) => void;
  addToQueueNext: (track: Track) => void;
  addToQueueEnd: (track: Track) => void;
  removeFromQueueAt: (index: number) => void;
  clearQueue: () => void;
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
}

const defaultTheme = { accentColor: "#9bd3ff", palette: ["#9bd3ff", "#6ba2d8", "#446c9d"] };

const initialState: PlayerState = {
  rpc: null,
  library: { tracks: [], loading: false, error: null },
  playlists: { items: [], activeId: null },
  player: {
    currentTrack: null,
    queue: [],
    isPlaying: false,
    currentTime: 0,
    volume: 0.8,
    playbackUrl: null,
    shuffleEnabled: false,
    repeatMode: "all",
    sessionHistoryPaths: [],
  },
  preferences: {
    likedTrackPaths: [],
    recentPlays: [],
    session: {
      currentTrackPath: null,
      queuePaths: [],
      currentTime: 0,
    },
  },
  settings: { watchFolders: [] },
  theme: defaultTheme,
};

export const usePlayerStore = create<PlayerState & PlayerActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setRpc: (rpc) => set({ rpc }),

      loadLibrary: async () => {
        const { rpc, preferences, player } = get();
        if (!rpc) {
          return;
        }

        set((state) => ({ library: { ...state.library, loading: true, error: null } }));

        try {
          let folders = await rpc.request.getWatchFolders();
          if (folders.length === 0) {
            const defaultPath = await rpc.request.getDefaultMusicPath();
            const addResult = await rpc.request.addFolder({ path: defaultPath });
            if (!addResult.success) {
              set({
                library: {
                  tracks: [],
                  loading: false,
                  error: addResult.error ?? "Could not add folder",
                },
                settings: { watchFolders: [] },
              });
              return;
            }
            folders = await rpc.request.getWatchFolders();
          }

          const { tracks: scannedTracks } = await rpc.request.scanLibrary({ paths: folders });
          const tracks = scannedTracks
            .map((track) => ({
              id: hashPath(track.path),
              path: track.path,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              time: track.time,
              genre: track.genre,
              picture: track.picture,
            }))
            .sort(
              (left, right) =>
                left.artist.localeCompare(right.artist) ||
                left.album.localeCompare(right.album) ||
                left.title.localeCompare(right.title)
            );

          const trackMap = new Map(tracks.map((track) => [track.path, track]));
          const restoredQueue = mapTrackPaths(preferences.session.queuePaths, tracks);
          const mappedCurrentTrack = player.currentTrack ? trackMap.get(player.currentTrack.path) ?? null : null;
          const restoredCurrentTrack = preferences.session.currentTrackPath
            ? trackMap.get(preferences.session.currentTrackPath) ?? mappedCurrentTrack
            : mappedCurrentTrack;
          const nextQueue =
            restoredQueue.length > 0
              ? restoredQueue
              : player.queue.length > 0
                ? mapTrackPaths(player.queue.map((track) => track.path), tracks)
                : tracks;
          const nextPlayer = {
            ...player,
            currentTrack: restoredCurrentTrack ?? null,
            queue: nextQueue,
            isPlaying: false,
            currentTime: restoredCurrentTrack
              ? clamp(preferences.session.currentTime, 0, Math.max(restoredCurrentTrack.duration, 0))
              : 0,
            playbackUrl: null,
          };

          set({
            library: { tracks, loading: false, error: null },
            settings: { watchFolders: folders },
            player: nextPlayer,
            preferences: {
              ...preferences,
              session: buildSession(nextPlayer),
            },
          });
        } catch (error) {
          set((state) => ({
            library: {
              ...state.library,
              loading: false,
              error: error instanceof Error ? error.message : "Failed to load library",
            },
          }));
        }
      },

      addFolder: async (folderPath) => {
        const { rpc } = get();
        if (!rpc) {
          set((state) => ({ library: { ...state.library, error: "App not ready. Please try again." } }));
          return;
        }

        const result = await rpc.request.addFolder({ path: folderPath });
        if (!result.success) {
          const message = result.error ?? "Failed to add folder";
          const hint =
            message.includes("does not exist") && folderPath.includes("Music")
              ? " Create the Music folder first, or add a different folder."
              : "";
          set((state) => ({
            library: { ...state.library, loading: false, error: message + hint },
          }));
          return;
        }

        const folders = await rpc.request.getWatchFolders();
        set((state) => ({ settings: { watchFolders: folders }, library: { ...state.library, error: null } }));
        await get().loadLibrary();
      },

      removeFolder: async (folderPath) => {
        const { rpc } = get();
        if (!rpc) {
          return;
        }

        await rpc.request.removeFolder({ path: folderPath });
        const folders = await rpc.request.getWatchFolders();
        set({ settings: { watchFolders: folders } });
        await get().loadLibrary();
      },

      playTrack: (track, queue = null, options = {}) => {
        const state = get();
        const nextQueue =
          queue ?? (state.player.queue.length > 0 ? state.player.queue : state.library.tracks);
        const nextSessionHistory =
          options.skipSessionHistory || !state.player.currentTrack || state.player.currentTrack.path === track.path
            ? state.player.sessionHistoryPaths
            : [...state.player.sessionHistoryPaths.slice(-49), state.player.currentTrack.path];

        const nextPlayer = {
          ...state.player,
          currentTrack: track,
          queue: nextQueue,
          isPlaying: options.autoplay ?? true,
          currentTime: options.startTime ?? 0,
          playbackUrl: null,
          sessionHistoryPaths: nextSessionHistory,
        };

        set({
          player: nextPlayer,
          preferences: {
            ...state.preferences,
            recentPlays:
              options.recordRecent === false || state.player.currentTrack?.path === track.path
                ? state.preferences.recentPlays
                : pushRecentPlay(state.preferences.recentPlays, track.path),
            session: buildSession(nextPlayer),
          },
        });
      },

      togglePlay: () => {
        const { library, player } = get();
        if (!player.currentTrack) {
          const fallbackQueue = player.queue.length > 0 ? player.queue : library.tracks;
          const firstTrack = fallbackQueue[0];
          if (firstTrack) {
            get().playTrack(firstTrack, fallbackQueue);
          }
          return;
        }

        set((state) => {
          const nextPlayer = { ...state.player, isPlaying: !state.player.isPlaying };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        });
      },

      handleNext: () => {
        const { currentTrack, queue, repeatMode, shuffleEnabled } = get().player;
        const nextTrack = resolveNextTrack({
          queue,
          currentTrack,
          shuffleEnabled,
          repeatMode,
          manual: true,
        });

        if (nextTrack) {
          get().playTrack(nextTrack, queue);
        }
      },

      handlePrev: () => {
        const { library, player } = get();

        if (player.shuffleEnabled && player.sessionHistoryPaths.length > 0) {
          const previousPath = player.sessionHistoryPaths[player.sessionHistoryPaths.length - 1];
          const previousTrack =
            player.queue.find((track) => track.path === previousPath) ??
            library.tracks.find((track) => track.path === previousPath);

          if (previousTrack) {
            set((state) => ({
              player: {
                ...state.player,
                sessionHistoryPaths: state.player.sessionHistoryPaths.slice(0, -1),
              },
            }));
            get().playTrack(previousTrack, player.queue, {
              skipSessionHistory: true,
              recordRecent: false,
            });
          }
          return;
        }

        const previousTrack = resolvePreviousTrack(player.queue, player.currentTrack);
        if (previousTrack) {
          get().playTrack(previousTrack, player.queue, {
            skipSessionHistory: true,
            recordRecent: false,
          });
        }
      },

      handleTrackEnd: () => {
        const { currentTrack, queue, repeatMode, shuffleEnabled } = get().player;
        const nextTrack = resolveNextTrack({
          queue,
          currentTrack,
          shuffleEnabled,
          repeatMode,
        });

        if (nextTrack) {
          const isSameTrack = currentTrack?.path === nextTrack.path;
          get().playTrack(nextTrack, queue, {
            skipSessionHistory: isSameTrack,
            recordRecent: !isSameTrack,
            startTime: 0,
          });
          return;
        }

        set((state) => {
          const nextPlayer = {
            ...state.player,
            isPlaying: false,
            currentTime: 0,
            playbackUrl: null,
          };

          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        });
      },

      setCurrentTime: (seconds) =>
        set((state) => {
          const nextPlayer = { ...state.player, currentTime: Math.max(0, seconds) };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        }),

      setVolume: (value) =>
        set((state) => ({
          player: { ...state.player, volume: clamp(value, 0, 1) },
        })),

      setPlaybackUrl: (url) => set((state) => ({ player: { ...state.player, playbackUrl: url } })),

      toggleShuffle: () =>
        set((state) => ({
          player: { ...state.player, shuffleEnabled: !state.player.shuffleEnabled },
        })),

      cycleRepeatMode: () =>
        set((state) => {
          const nextRepeatMode: RepeatMode =
            state.player.repeatMode === "off"
              ? "all"
              : state.player.repeatMode === "all"
                ? "one"
                : "off";
          return {
            player: { ...state.player, repeatMode: nextRepeatMode },
          };
        }),

      toggleLikedTrack: (track) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            likedTrackPaths: state.preferences.likedTrackPaths.includes(track.path)
              ? state.preferences.likedTrackPaths.filter((path) => path !== track.path)
              : [track.path, ...state.preferences.likedTrackPaths],
          },
        })),

      addToQueueNext: (track) =>
        set((state) => {
          const baseQueue =
            state.player.queue.length > 0
              ? [...state.player.queue]
              : state.player.currentTrack
                ? [state.player.currentTrack]
                : [];

          if (baseQueue.length === 0) {
            baseQueue.push(track);
          } else {
            const currentIndex = state.player.currentTrack
              ? baseQueue.findIndex((item) => item.path === state.player.currentTrack?.path)
              : -1;
            baseQueue.splice(currentIndex >= 0 ? currentIndex + 1 : 0, 0, track);
          }

          const nextPlayer = { ...state.player, queue: baseQueue };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        }),

      addToQueueEnd: (track) =>
        set((state) => {
          const baseQueue =
            state.player.queue.length > 0
              ? [...state.player.queue, track]
              : state.player.currentTrack
                ? [state.player.currentTrack, track]
                : [track];
          const nextPlayer = { ...state.player, queue: baseQueue };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        }),

      removeFromQueueAt: (index) => {
        const { player } = get();
        if (index < 0 || index >= player.queue.length) {
          return;
        }

        const removingTrack = player.queue[index];
        const nextQueue = player.queue.filter((_, queueIndex) => queueIndex !== index);

        if (removingTrack.path === player.currentTrack?.path) {
          if (nextQueue.length === 0) {
            set((state) => {
              const nextPlayer = {
                ...state.player,
                currentTrack: null,
                queue: [],
                isPlaying: false,
                currentTime: 0,
                playbackUrl: null,
              };
              return {
                player: nextPlayer,
                preferences: {
                  ...state.preferences,
                  session: buildSession(nextPlayer),
                },
              };
            });
            return;
          }

          const nextTrack = nextQueue[Math.min(index, nextQueue.length - 1)];
          get().playTrack(nextTrack, nextQueue, {
            skipSessionHistory: true,
            recordRecent: false,
          });
          return;
        }

        set((state) => {
          const nextPlayer = { ...state.player, queue: nextQueue };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        });
      },

      clearQueue: () =>
        set((state) => {
          const nextQueue = state.player.currentTrack ? [state.player.currentTrack] : [];
          const nextPlayer = { ...state.player, queue: nextQueue };
          return {
            player: nextPlayer,
            preferences: {
              ...state.preferences,
              session: buildSession(nextPlayer),
            },
          };
        }),

      updateTheme: (accentColor, palette) => set({ theme: { accentColor, palette } }),

      resetTheme: () => set({ theme: defaultTheme }),

      loadPlaylists: async () => {
        const { rpc } = get();
        if (!rpc) {
          return;
        }

        const list = await rpc.request.listPlaylists();
        const items: Playlist[] = list
          .map((playlist, index) => ({
            id: `pl_${index}_${playlist.path}`,
            name: playlist.name,
            path: playlist.path,
            trackIds: playlist.entries.map((entry) => entry.path),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        set((state) => ({ playlists: { ...state.playlists, items } }));
      },

      setActivePlaylist: (id) => set((state) => ({ playlists: { ...state.playlists, activeId: id } })),

      createPlaylist: async (name) => {
        const { rpc } = get();
        if (!rpc) {
          return;
        }

        const directory = await rpc.request.getPlaylistsDir();
        await rpc.request.savePlaylist({
          path: directory,
          name: name.trim(),
          entries: [],
        });
        await get().loadPlaylists();
      },

      renamePlaylist: async (playlistId, newName) => {
        const { rpc, playlists } = get();
        if (!rpc) {
          return;
        }

        const playlist = playlists.items.find((item) => item.id === playlistId);
        if (!playlist) {
          return;
        }

        await rpc.request.renamePlaylist({ oldPath: playlist.path, newName: newName.trim() });
        await get().loadPlaylists();
      },

      deletePlaylist: async (playlistId) => {
        const { rpc, playlists } = get();
        if (!rpc) {
          return;
        }

        const playlist = playlists.items.find((item) => item.id === playlistId);
        if (!playlist) {
          return;
        }

        await rpc.request.deletePlaylist({ path: playlist.path });
        await get().loadPlaylists();
      },

      addTrackToPlaylist: async (playlistId, track) => {
        const { rpc, playlists } = get();
        if (!rpc) {
          return;
        }

        const playlist = playlists.items.find((item) => item.id === playlistId);
        if (!playlist || playlist.trackIds.includes(track.path)) {
          return;
        }

        const directory = playlist.path.replace(/[/\\][^/\\]+$/, "");
        const name = playlist.name.replace(/\.m3u8?$/i, "");
        await rpc.request.savePlaylist({
          path: directory,
          name,
          entries: [...playlist.trackIds, track.path],
        });
        await get().loadPlaylists();
      },

      removeTrackFromPlaylist: async (playlistId, trackPath) => {
        const { rpc, playlists } = get();
        if (!rpc) {
          return;
        }

        const playlist = playlists.items.find((item) => item.id === playlistId);
        if (!playlist) {
          return;
        }

        const directory = playlist.path.replace(/[/\\][^/\\]+$/, "");
        const name = playlist.name.replace(/\.m3u8?$/i, "");
        await rpc.request.savePlaylist({
          path: directory,
          name,
          entries: playlist.trackIds.filter((path) => path !== trackPath),
        });
        await get().loadPlaylists();
      },

      loadPlaylistTracks: (playlistId) => {
        const { playlists, library } = get();
        const playlist = playlists.items.find((item) => item.id === playlistId);
        if (!playlist) {
          return [];
        }

        return mapTrackPaths(playlist.trackIds, library.tracks);
      },

      getQueueFromLibrary: () => get().library.tracks,
    }),
    {
      name: "winamp-player-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        player: {
          ...state.player,
          currentTrack: null,
          queue: [],
          isPlaying: false,
          playbackUrl: null,
          sessionHistoryPaths: [],
        },
        preferences: state.preferences,
      }),
    }
  )
);
