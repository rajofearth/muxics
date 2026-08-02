// libraryStore — local + remote library, settings, sync
import { create } from "zustand";
import type { LibrarySource, Track } from "../types";
import { parseTime } from "../utils";
import { getRpc } from "./authStore";
import { clearAllCachedStreamUrls } from "./streamPreloader";
import { mergeTracks, toTrack, mergeUniqueTracks, pLimit } from "./converters";
import { bench } from "../bench";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i);
    h |= 0;
  }
  return `local:${Math.abs(h).toString(36)}:${p}`;
}

function collectPlaylistTracksFromRaw(playlists: any[]): Track[] {
  const allTracks: Track[] = [];
  for (const pl of playlists) {
    if (pl.tracks && Array.isArray(pl.tracks)) {
      for (const t of pl.tracks) {
        allTracks.push(toTrack(t));
      }
    }
  }
  return allTracks;
}


// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

export interface LibraryState {
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
  settings: { watchFolders: string[] };
}

export interface LibraryActions {
  setLibrarySource: (source: LibrarySource) => void;
  getSearchTracks: (query: string) => { source: LibrarySource; tracks: Track[] };
  getTrack: (trackId: string) => Track | undefined;
  getAllTracks: () => Track[];
  loadLibrary: () => Promise<void>;
  hydrateYtMusicFromCache: () => Promise<void>;
  syncYtMusicLibrary: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  /** Cross-store setter: bulk merge remote tracks into library, recomputes library.tracks */
  mergeRemoteTracks: (tracks: Track[]) => void;
  /** Cross-store setter: clears remoteTracks and recomputes library.tracks */
  resetRemoteLibrary: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  (set, get) => ({
    library: {
      tracks: [],
      localTracks: [],
      remoteTracks: [],
      loading: false,
      syncingRemote: false,
      error: null,
      scanProgress: 0,
      source: (typeof localStorage !== "undefined" && (localStorage.getItem("muxics-library-source") as LibrarySource)) || "local",
    },
    settings: { watchFolders: [] },

    setLibrarySource: async (source) => {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("muxics-library-source", source);
      }
      set((s) => ({
        library: {
          ...s.library,
          source,
          tracks: mergeTracks(
            source,
            s.library.localTracks,
            s.library.remoteTracks,
          ),
        },
      }));
      const { usePlaylistStore } = await import("./playlistStore");
      usePlaylistStore.getState().recomputePlaylists(source);
      void usePlaylistStore.getState().loadCachedPlaylist();
    },

    getSearchTracks: (query) => {
      const { source, localTracks, remoteTracks } = get().library;
      const normalizedQuery = query.toLowerCase();
      return {
        source,
        tracks: mergeTracks(source, localTracks, remoteTracks).filter(
          (track) =>
            track.title.toLowerCase().includes(normalizedQuery) ||
            track.artist.toLowerCase().includes(normalizedQuery) ||
            track.album.toLowerCase().includes(normalizedQuery),
        ),
      };
    },

    getTrack: (trackId) => {
      const { localTracks, remoteTracks } = get().library;
      return [...localTracks, ...remoteTracks].find(
        (track) => track.id === trackId,
      );
    },

    getAllTracks: () => {
      const { localTracks, remoteTracks } = get().library;
      return [...localTracks, ...remoteTracks];
    },

    loadLibrary: async () => {
      const rpc = getRpc();
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
                tracks: mergeTracks(
                  s.library.source,
                  [],
                  s.library.remoteTracks,
                ),
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
                scanProgress:
                  files.length === 0
                    ? 100
                    : Math.round((completed / files.length) * 100),
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
            tracks: mergeTracks(
              s.library.source,
              localTracks,
              s.library.remoteTracks,
            ),
            loading: false,
            error: null,
            scanProgress: 100,
          },
          settings: { watchFolders: folders },
        }));

        // Bench: library:visible — end of loadLibrary, post-frame so the mark
        // lands once the updated list has rendered (design §2.3 mark set).
        if (bench.enabled) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              bench.mark("library:visible");
            });
          });
        }
      } catch (err) {
        set((s) => ({
          library: {
            ...s.library,
            loading: false,
            error:
              err instanceof Error ? err.message : "Failed to load library",
            scanProgress: 0,
          },
        }));
      }
    },

    hydrateYtMusicFromCache: async () => {
      const rpc = getRpc();
      if (!rpc) return;

      const { useAuthStore } = await import("./authStore");
      const auth = useAuthStore.getState().auth;
      if (!auth.loggedIn) return;

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

      const remoteTracks = mergeUniqueTracks(
        cached.tracks.map(toTrack),
        collectPlaylistTracksFromRaw(cached.playlists),
      );

      set((s) => {
        return {
          library: {
            ...s.library,
            remoteTracks,
            tracks: mergeTracks(
              s.library.source,
              s.library.localTracks,
              remoteTracks,
            ),
            lastSyncedAt: cached.lastSyncedAt ?? s.library.lastSyncedAt,
          },
        };
      });

      const { usePlaylistStore } = await import("./playlistStore");
      usePlaylistStore.getState().setRemotePlaylists(cached.playlists);
      void usePlaylistStore.getState().loadCachedPlaylist();
      void usePlaylistStore.getState().hydrateAllYtPlaylists();

      const { useUiStore } = await import("./uiStore");
      useUiStore.getState().syncFavoritesFromTracks(remoteTracks);
    },

    syncYtMusicLibrary: async () => {
      const rpc = getRpc();
      if (!rpc) return;

      const { useAuthStore } = await import("./authStore");
      const auth = useAuthStore.getState().auth;
      if (!auth.loggedIn) return;

      set((s) => ({
        library: { ...s.library, syncingRemote: true, error: null },
      }));

      try {
        const synced = await rpc.request.ytmusicSyncLibrary();

        const freshTracks = mergeUniqueTracks(
          synced.tracks.map(toTrack),
          collectPlaylistTracksFromRaw(synced.playlists),
        );

        // Preserve tracks from playlists that were previously hydrated
        // (they have full metadata including cover art) but weren't in the
        // sync result (e.g. tracks that exist in a playlist but not in the
        // user's YouTube Music library "Songs" collection).
        const remoteTracks = mergeUniqueTracks(
          freshTracks,
          get().library.remoteTracks,
        );

        set((s) => {
          return {
            library: {
              ...s.library,
              remoteTracks,
              tracks: mergeTracks(
                s.library.source,
                s.library.localTracks,
                remoteTracks,
              ),
              syncingRemote: false,
              lastSyncedAt: synced.lastSyncedAt,
            },
          };
        });

        useAuthStore.getState().setLastSyncedAt(synced.lastSyncedAt);

        const { usePlaylistStore } = await import("./playlistStore");
        usePlaylistStore.getState().setRemotePlaylists(synced.playlists);
        void usePlaylistStore.getState().loadCachedPlaylist();
        void usePlaylistStore.getState().hydrateAllYtPlaylists();

        const { useUiStore } = await import("./uiStore");
        useUiStore.getState().syncFavoritesFromTracks(remoteTracks);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to sync YouTube Music.";
        const isRejected = message.includes("Imported browser session");
        if (isRejected) {
          // Don't immediately surface the error — try auto-recovery
          // via the browser extension background worker.
          set((s) => ({
            library: { ...s.library, syncingRemote: false },
          }));
          await useAuthStore.getState().startSessionRecovery();
        } else {
          set((s) => ({
            library: {
              ...s.library,
              syncingRemote: false,
              error: message,
            },
          }));
        }
      }
    },

    addFolder: async (folderPath) => {
      const rpc = getRpc();
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
      const rpc = getRpc();
      if (!rpc) return;

      await rpc.request.removeFolder({ path: folderPath });
      const sep = folderPath.includes("\\") ? "\\" : "/";
      const prefix = folderPath.endsWith(sep)
        ? folderPath
        : `${folderPath}${sep}`;

      set((s) => {
        const localTracks = s.library.localTracks.filter(
          (t) => !t.path?.startsWith(prefix),
        );
        return {
          settings: {
            watchFolders: s.settings.watchFolders.filter(
              (p) => p !== folderPath,
            ),
          },
          library: {
            ...s.library,
            localTracks,
            tracks: mergeTracks(
              s.library.source,
              localTracks,
              s.library.remoteTracks,
            ),
            loading: false,
            error: null,
          },
        };
      });
    },

    // -------------------------------------------------------------------------
    // Cross-store setters — called by authStore / playlistStore / searchStore
    // -------------------------------------------------------------------------

    mergeRemoteTracks: (tracks) => {
      set((s) => {
        const remoteTracks = mergeUniqueTracks(s.library.remoteTracks, tracks);
        return {
          library: {
            ...s.library,
            remoteTracks,
            tracks: mergeTracks(
              s.library.source,
              s.library.localTracks,
              remoteTracks,
            ),
          },
        };
      });
    },

    resetRemoteLibrary: async () => {
      set((s) => ({
        library: {
          ...s.library,
          remoteTracks: [],
          tracks: mergeTracks("local", s.library.localTracks, []),
          source: "local",
          lastSyncedAt: undefined,
        },
      }));
      clearAllCachedStreamUrls();
      const { usePlaylistStore } = await import("./playlistStore");
      const { useUiStore } = await import("./uiStore");
      usePlaylistStore.getState().resetRemotePlaylists();
      useUiStore.getState().resetRemoteUi();
    },
  }),
);
