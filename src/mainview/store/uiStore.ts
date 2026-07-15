// uiStore — search, home feed, favorites, theme
import { create } from "zustand";
import type { LibrarySource, Playlist, Track } from "../types";
import type { PlaylistResult, TrackResult } from "../../shared/desktop-contract";
import { getRpc, useAuthStore } from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { showToast } from "../components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YTM_REMOTE_SEARCH_DEBOUNCE_MS = 280;

// Module-level debounce timer for YTM remote search (shared across setSearchQuery calls)
let ytmSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let ytmSearchGeneration = 0;

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

const defaultTheme = {
  accentColor: "#ff6b6b",
  palette: ["#ff6b6b", "#e55a5a", "#cc4c4c"],
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

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

function loadThemeName(): string {
  try {
    return localStorage.getItem("muxics-theme") ?? "default";
  } catch {}
  return "default";
}

// ---------------------------------------------------------------------------
// Private helpers (not exported)
// ---------------------------------------------------------------------------

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
    liked: track.liked,
  };
}

function toPlaylist(playlist: PlaylistResult): Playlist {
  const trackIdsFromEntries = playlist.entries.map((entry) => entry.id);
  const trackIdsFromTracks = (playlist.tracks ?? []).map((t) => t.id);
  const trackIds =
    trackIdsFromEntries.length > 0 ? trackIdsFromEntries : trackIdsFromTracks;

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
    author: playlist.author,
    picture: playlist.picture,
    type: playlist.type,
  };
}

function mergeTracks(
  source: LibrarySource,
  localTracks: Track[],
  remoteTracks: Track[],
): Track[] {
  if (source === "local") {
    return localTracks;
  }

  if (source === "ytmusic") {
    return remoteTracks;
  }

  return [...remoteTracks, ...localTracks];
}



// ---------------------------------------------------------------------------
// State + Actions
// ---------------------------------------------------------------------------

export interface UiState {
  search: {
    query: string;
    results: Track[];
    albums: Playlist[];
    playlists: Playlist[];
    loading: boolean;
    error: string | null;
  };
  homeFeed: {
    sections: { title: string; items: (Track | Playlist)[] }[];
    loading: boolean;
    error: string | null;
  };
  favorites: Set<string>;
  theme: { accentColor: string; palette: string[] };
  themeName: string;
}

export interface UiActions {
  setSearchQuery(query: string): Promise<void>;
  loadHomeFeed(): Promise<void>;
  toggleFavorite(trackId: string): Promise<void>;
  isFavorite(trackId: string): boolean;
  getFavoriteTracks(): Track[];
  syncFavoritesFromTracks(tracks: Track[]): void;
  updateTheme(accent: string, palette: string[]): void;
  resetTheme(): void;
  setThemeName(name: string): void;
  resetRemoteUi(): void;
  /** Bulk favorites update called by sync operations (e.g. library sync, cache hydration) */
  setFavoritesFromSync(favs: Set<string>): void;
}

export const useUiStore = create<UiState & UiActions>()((set, get) => ({
  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  search: {
    query: "",
    results: [],
    albums: [],
    playlists: [],
    loading: false,
    error: null,
  },
  homeFeed: { sections: [], loading: false, error: null },
  favorites: loadFavorites(),
  theme: defaultTheme,
  themeName: loadThemeName(),

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  setSearchQuery: async (query) => {
    const trimmed = query.trim();

    // Cancel any pending remote search immediately
    if (ytmSearchDebounceTimer) {
      clearTimeout(ytmSearchDebounceTimer);
      ytmSearchDebounceTimer = null;
    }

    if (!trimmed) {
      ytmSearchGeneration += 1;
      set({
        search: {
          query: "",
          results: [],
          albums: [],
          playlists: [],
          loading: false,
          error: null,
        },
      });
      return;
    }

    // Immediately update the query so the input feels responsive,
    // then compute search results asynchronously after the render
    set({
      search: {
        query,
        results: [],
        albums: [],
        playlists: [],
        loading: true,
        error: null,
      },
    });

    // Schedule the heavy search work after React has painted the new input value
    void setTimeout(() => {
      const library = useLibraryStore.getState().library;
      const rpc = getRpc();
      const auth = useAuthStore.getState().auth;

      const q = trimmed.toLowerCase();
      const localResults = mergeTracks(
        library.source,
        library.localTracks,
        library.remoteTracks,
      ).filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q),
      );

      const needsRemote = Boolean(
        rpc && auth.loggedIn && library.source !== "local",
      );

      if (!needsRemote) {
        set({
          search: {
            query,
            results: localResults,
            albums: [],
            playlists: [],
            loading: false,
            error: null,
          },
        });
        return;
      }

      // Update with local results while remote search is pending
      set({
        search: {
          query,
          results: localResults,
          albums: [],
          playlists: [],
          loading: true,
          error: null,
        },
      });

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

          const rpcNow = getRpc();
          const authNow = useAuthStore.getState().auth;
          const libNow = useLibraryStore.getState().library;

          if (!rpcNow || !authNow.loggedIn || libNow.source === "local") {
            return;
          }

          const localAgain = mergeTracks(
            libNow.source,
            libNow.localTracks,
            libNow.remoteTracks,
          ).filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.artist.toLowerCase().includes(q) ||
              t.album.toLowerCase().includes(q),
          );

          try {
            const remoteResults = await rpcNow.request.ytmusicSearch({
              query: trimmed,
            });
            if (
              generation !== ytmSearchGeneration ||
              get().search.query.trim() !== trimmed
            ) {
              return;
            }
            const normalizedTracks = remoteResults.tracks.map(toTrack);
            const normalizedAlbums = remoteResults.albums.map(toPlaylist);
            const normalizedPlaylists = remoteResults.playlists.map(toPlaylist);

            get().syncFavoritesFromTracks(normalizedTracks);

            // Add search results to remoteTracks so that UI components like TrackTable
            // can find the full track metadata (artist, duration, etc)
            useLibraryStore.getState().mergeRemoteTracks(normalizedTracks);

            const combinedTracks =
              libNow.source === "all"
                ? [...normalizedTracks, ...localAgain].filter(
                    (track, index, list) =>
                      list.findIndex((entry) => entry.id === track.id) ===
                      index,
                  )
                : normalizedTracks;

            set({
              search: {
                query: query,
                results: combinedTracks,
                albums: normalizedAlbums,
                playlists: normalizedPlaylists,
                loading: false,
                error: null,
              },
            });
          } catch (error) {
            if (
              generation !== ytmSearchGeneration ||
              get().search.query.trim() !== trimmed
            ) {
              return;
            }
            set({
              search: {
                query: query,
                results: localAgain,
                albums: [],
                playlists: [],
                loading: false,
                error:
                  error instanceof Error ? error.message : "Search failed.",
              },
            });
          }
        })();
      }, YTM_REMOTE_SEARCH_DEBOUNCE_MS);
    });
  },

  loadHomeFeed: async () => {
    const rpc = getRpc();
    const auth = useAuthStore.getState().auth;

    if (!rpc || !auth.loggedIn) return;

    if (get().homeFeed.loading) return;

    console.log("[uiStore] Loading home feed...");
    set((s) => ({ homeFeed: { ...s.homeFeed, loading: true, error: null } }));

    try {
      const result = await rpc.request.ytmusicGetHomeFeed();
      console.log(
        `[uiStore] Got home feed with ${result.sections.length} sections`,
      );

      const sections = result.sections.map((sec) => {
        const items = sec.items.map((item) => {
          if ("title" in item) {
            return toTrack(item);
          }
          return toPlaylist(item);
        });
        return {
          title: sec.title,
          items,
        };
      });

      const allHomeTracks = sections.flatMap((sec) =>
        sec.items.filter((i): i is Track => "title" in i),
      );
      get().syncFavoritesFromTracks(allHomeTracks);

      useLibraryStore.getState().mergeRemoteTracks(allHomeTracks);

      set({
        homeFeed: {
          sections,
          loading: false,
          error: null,
        },
      });
    } catch (error) {
      console.error("[uiStore] Failed to load home feed", error);
      set((s) => ({
        homeFeed: {
          ...s.homeFeed,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load home feed",
        },
      }));
    }
  },

  toggleFavorite: async (trackId) => {
    const rpc = getRpc();

    // TODO: read localTracks + remoteTracks from libraryStore
    const localTracks: Track[] = useLibraryStore.getState().library.localTracks;
    const remoteTracks: Track[] =
      useLibraryStore.getState().library.remoteTracks;
    const track = [...localTracks, ...remoteTracks].find(
      (item) => item.id === trackId,
    );
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
        err instanceof Error
          ? `Failed to update favorites: ${err.message}`
          : "Failed to update favorites",
        "error",
      );
      throw err;
    }
  },

  isFavorite: (trackId) => get().favorites.has(trackId),

  getFavoriteTracks: () => {
    const { favorites } = get();
    const localTracks = useLibraryStore.getState().library.localTracks;
    const remoteTracks = useLibraryStore.getState().library.remoteTracks;
    return [...localTracks, ...remoteTracks].filter((t) =>
      favorites.has(t.id),
    );
  },

  syncFavoritesFromTracks: (tracks: Track[]) => {
    set((s) => {
      const next = new Set(s.favorites);
      let changed = false;
      for (const t of tracks) {
        if (t.liked === true && !next.has(t.id)) {
          next.add(t.id);
          changed = true;
        } else if (t.liked === false && next.delete(t.id)) {
          changed = true;
        }
      }
      if (changed) {
        saveFavorites(next);
        return { favorites: next };
      }
      return {};
    });
  },

  /** Bulk favorites replacement — called by sync/cache hydration in other stores */
  setFavoritesFromSync: (favs: Set<string>) => {
    set({ favorites: favs });
    saveFavorites(favs);
  },

  updateTheme: (accentColor, palette) =>
    set({ theme: { accentColor, palette } }),

  resetTheme: () => set({ theme: defaultTheme }),

  setThemeName: (name) => {
    try {
      localStorage.setItem("muxics-theme", name);
    } catch {}
    set({ themeName: name });
  },

  resetRemoteUi: () => {
    set({
      search: {
        query: "",
        results: [],
        albums: [],
        playlists: [],
        loading: false,
        error: null,
      },
      homeFeed: { sections: [], loading: false, error: null },
    });
  },
}));
