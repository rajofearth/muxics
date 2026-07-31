// uiStore — search, home feed, favorites, theme
import { create } from "zustand";
import type { Playlist, Track } from "../types";
import { getRpc, useAuthStore } from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { showToast } from "../components/Toast";
import { toTrack, toPlaylist } from "./converters";

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
      const library = useLibraryStore.getState();
      const rpc = getRpc();
      const auth = useAuthStore.getState().auth;
      const { source, tracks: localResults } = library.getSearchTracks(trimmed);

      const needsRemote = Boolean(
        rpc && auth.loggedIn && source !== "local",
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
          const libraryNow = useLibraryStore.getState();
          const { source: sourceNow, tracks: localAgain } =
            libraryNow.getSearchTracks(trimmed);

          if (!rpcNow || !authNow.loggedIn || sourceNow === "local") {
            return;
          }

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
            libraryNow.mergeRemoteTracks(normalizedTracks);

            const combinedTracks =
              sourceNow === "all"
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

    const track = useLibraryStore.getState().getTrack(trackId);
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
    return useLibraryStore
      .getState()
      .getAllTracks()
      .filter((t) => favorites.has(t.id));
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
