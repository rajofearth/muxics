// playlistStore — local + remote + transient playlists
import { create } from "zustand";
import type { LibrarySource, Playlist, Track } from "../types";
import type { PlaylistResult, TrackResult } from "../../shared/desktop-contract";
import { getRpc } from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { useUiStore } from "./uiStore";
import { showToast } from "../components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------



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

function ytTrackStubFromId(trackId: string): Track {
  const providerId = trackId.startsWith("ytmusic:")
    ? trackId.slice("ytmusic:".length)
    : trackId;
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
  const hasTracksArray = Array.isArray(pl.tracks);
  const target = pl.listedItemCount ?? 0;

  const rich =
    pl.tracks?.some((t) => t.duration > 0 || Boolean(t.artist?.trim())) ??
    false;

  if (nIds === 0 && nTracks === 0) {
    return !hasTracksArray;
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


/** Merge local + remote + transient playlists respecting the active library source. */
function mergePlaylists(
  source: LibrarySource,
  localItems: Playlist[],
  remoteItems: Playlist[],
  transientItems: Playlist[] = [],
): Playlist[] {
  const base =
    source === "local"
      ? localItems
      : source === "ytmusic"
        ? remoteItems
        : [...remoteItems, ...localItems];

  // Include transient items (browsed from home/search but not in library)
  // that are not already in the library base
  const libraryIds = new Set(base.map((p) => p.id));
  const uniqueTransient = transientItems.filter((p) => !libraryIds.has(p.id));

  return [...base, ...uniqueTransient];
}

// ---------------------------------------------------------------------------
// State + Actions
// ---------------------------------------------------------------------------

export interface PlaylistState {
  playlists: {
    items: Playlist[];
    localItems: Playlist[];
    remoteItems: Playlist[];
    /** Browsed playlists not in library (from home feed / search) */
    transientItems: Playlist[];
    activeId: string | null;
    hydratingById: Record<string, boolean>;
    hydrationErrors: Record<string, string | null>;
  };
}

export interface PlaylistActions {
  loadPlaylists(): Promise<void>;
  loadCachedPlaylist(): Promise<void>;
  ensurePlaylistHydrated(playlistId: string): Promise<void>;
  hydrateAllYtPlaylists(): Promise<void>;
  setActivePlaylist(id: string | null): void;
  createPlaylist(name: string): Promise<void>;
  renamePlaylist(playlistId: string, newName: string): Promise<void>;
  deletePlaylist(playlistId: string): Promise<void>;
  addTrackToPlaylist(playlistId: string, track: Track): Promise<void>;
  removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  savePlaylistToLibrary(playlistId: string): Promise<void>;
  setRemotePlaylists(remoteItems: PlaylistResult[]): void;
  recomputePlaylists(source: LibrarySource): void;
  unsavePlaylistFromLibrary(playlistId: string): Promise<void>;
  resetRemotePlaylists(): void;
  loadPlaylistTracks(playlistId: string): Track[];
}

export const usePlaylistStore = create<PlaylistState & PlaylistActions>()(
  (set, get) => ({
    // -------------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------------
    playlists: {
      items: [],
      localItems: [],
      remoteItems: [],
      transientItems: [],
      activeId: null,
      hydratingById: {},
      hydrationErrors: {},
    },

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    setRemotePlaylists: (playlists) => {
      const remoteItems = playlists.map(toPlaylist);
      set((s) => ({
        playlists: {
          ...s.playlists,
          remoteItems,
          items: mergePlaylists(
            useLibraryStore.getState().library.source,
            s.playlists.localItems,
            remoteItems,
            s.playlists.transientItems,
          ),
        },
      }));
    },

    recomputePlaylists: (source) => {
      set((s) => ({
        playlists: {
          ...s.playlists,
          items: mergePlaylists(
            source,
            s.playlists.localItems,
            s.playlists.remoteItems,
            s.playlists.transientItems,
          ),
        },
      }));
    },

    resetRemotePlaylists: () => {
      set((s) => ({
        playlists: {
          ...s.playlists,
          remoteItems: [],
          transientItems: [],
          items: mergePlaylists(
            useLibraryStore.getState().library.source,
            s.playlists.localItems,
            [],
            [],
          ),
          activeId:
            s.playlists.activeId?.startsWith("ytmusic:")
              ? null
              : s.playlists.activeId,
          hydratingById: {},
          hydrationErrors: {},
        },
      }));
    },

    loadPlaylists: async () => {
      const rpc = getRpc();
      if (!rpc) return;

      // TODO: read library.source from libraryStore
      // const { library } = useLibraryStore.getState();
      const librarySource = useLibraryStore.getState().library.source;

      const localList = await rpc.request.listPlaylists();
      const localItems = localList.map(toPlaylist);

      set((s) => ({
        playlists: {
          ...s.playlists,
          localItems,
          items: mergePlaylists(
            librarySource,
            localItems,
            s.playlists.remoteItems,
          ),
        },
      }));
    },

    loadCachedPlaylist: async () => {
      const rpc = getRpc();
      if (!rpc) return;

      try {
        const cachedTrackIds = await rpc.request.getFullyCachedTrackIds();
        if (!cachedTrackIds) return;

        const { library } = useLibraryStore.getState();
        const { usePlayerStore } = await import("./playerStore");
        const recentlyPlayed = usePlayerStore.getState().recentlyPlayed;
        const allKnownTracks = Object.values(
          [...library.remoteTracks, ...library.localTracks, ...recentlyPlayed].reduce(
            (acc, t) => {
              acc[t.id] = t;
              return acc;
            },
            {} as Record<string, Track>,
          ),
        );

        const cachedTracks = allKnownTracks.filter((t) =>
          cachedTrackIds.includes(t.providerId),
        );

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

        // TODO: read library.source from libraryStore
        const librarySource = useLibraryStore.getState().library.source;

        set((s) => {
          const withoutCached = s.playlists.remoteItems.filter(
            (p) => p.id !== "ytmusic-cached",
          );
          const nextRemoteItems = [cachedPlaylist, ...withoutCached];
          return {
            playlists: {
              ...s.playlists,
              remoteItems: nextRemoteItems,
              items: mergePlaylists(
                librarySource,
                s.playlists.localItems,
                nextRemoteItems,
              ),
            },
          };
        });
      } catch {}
    },

    ensurePlaylistHydrated: async (playlistId) => {
      const rpc = getRpc();
      if (!rpc) return;

      const { playlists } = get();

      let playlist = playlists.items.find((item) => item.id === playlistId);

      if (!playlist) {
        const { homeFeed, search } = useUiStore.getState();
        const candidates: Playlist[] = [
          ...homeFeed.sections.flatMap((section) =>
            section.items.filter((item): item is Playlist => !("title" in item)),
          ),
          ...(search.albums ?? []),
          ...(search.playlists ?? []),
        ];
        const found = candidates.find((item) => item.id === playlistId);
        if (found) {
          playlist = found;

          // TODO: read library.source from libraryStore
          const librarySource = useLibraryStore.getState().library.source;

          set((s) => {
            const transientItems = s.playlists.transientItems.some(
              (item) => item.id === found.id,
            )
              ? s.playlists.transientItems
              : [...s.playlists.transientItems, found];
            return {
              playlists: {
                ...s.playlists,
                transientItems,
                items: mergePlaylists(
                  librarySource,
                  s.playlists.localItems,
                  s.playlists.remoteItems,
                  transientItems,
                ),
              },
            };
          });
        }
      }

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
          hydrationErrors: {
            ...s.playlists.hydrationErrors,
            [playlistId]: null,
          },
        },
      }));

      try {
        const detailed = await rpc.request.ytmusicGetPlaylist({
          playlistId: playlist.providerId,
        });
        if (!detailed) {
          throw new Error(
            "Playlist tracks could not be loaded from YouTube Music.",
          );
        }

        const updated = toPlaylist(detailed);

        useUiStore.getState().syncFavoritesFromTracks(updated.tracks ?? []);

        set((s) => {
          // Update both remoteItems and transientItems if the playlist exists in them
          const remoteItems = s.playlists.remoteItems.map((item) =>
            item.id === updated.id ? updated : item,
          );
          const transientItems = s.playlists.transientItems.map((item) =>
            item.id === updated.id ? updated : item,
          );

          // Collect all tracks from all playlists to ensure we have metadata for everything in library
          const allPlaylistTracks = collectPlaylistTracks([
            ...remoteItems,
            ...transientItems,
          ]);

          useLibraryStore.getState().mergeRemoteTracks(allPlaylistTracks);

          const librarySource = useLibraryStore.getState().library.source;

          return {
            playlists: {
              ...s.playlists,
              remoteItems,
              transientItems,
              items: mergePlaylists(
                librarySource,
                s.playlists.localItems,
                remoteItems,
                transientItems,
              ),
              hydratingById: {
                ...s.playlists.hydratingById,
                [playlistId]: false,
              },
              hydrationErrors: {
                ...s.playlists.hydrationErrors,
                [playlistId]: null,
              },
            },
          };
        });
      } catch (error) {
        set((s) => ({
          playlists: {
            ...s.playlists,
            hydratingById: {
              ...s.playlists.hydratingById,
              [playlistId]: false,
            },
            hydrationErrors: {
              ...s.playlists.hydrationErrors,
              [playlistId]:
                error instanceof Error
                  ? error.message
                  : "Failed to load YouTube Music playlist.",
            },
          },
        }));
      }
    },

    hydrateAllYtPlaylists: async () => {
      const { playlists, ensurePlaylistHydrated } = get();
      const ytPlaylists = playlists.items.filter(
        (p) =>
          p.provider === "ytmusic" &&
          p.id !== "ytmusic-cached" &&
          playlistNeedsYtDetailFetch(p),
      );
      if (ytPlaylists.length === 0) return;

      // Hydrate with limited concurrency
      const CONCURRENT = 3;
      let idx = 0;
      const next = (): Promise<void> => {
        if (idx >= ytPlaylists.length) return Promise.resolve();
        const playlist = ytPlaylists[idx++];
        return ensurePlaylistHydrated(playlist.id).then(next, next);
      };
      const workers = Array.from({ length: CONCURRENT }, () => next());
      await Promise.all(workers);
    },

    setActivePlaylist: (id) =>
      set((s) => ({ playlists: { ...s.playlists, activeId: id } })),

    createPlaylist: async (name) => {
      const rpc = getRpc();
      if (!rpc) return;

      // TODO: read library.source from libraryStore
      const librarySource = useLibraryStore.getState().library.source;

      if (librarySource === "ytmusic") {
        await rpc.request.ytmusicCreatePlaylist({ name });
        void useLibraryStore.getState().syncYtMusicLibrary();
        return;
      }

      const dir = await rpc.request.getPlaylistsDir();
      await rpc.request.savePlaylist({ path: dir, name, entries: [] });
      await get().loadPlaylists();
    },

    renamePlaylist: async (playlistId, newName) => {
      const rpc = getRpc();
      if (!rpc) return;
      const { playlists } = get();
      const pl = playlists.items.find((p) => p.id === playlistId);
      if (!pl) return;

      if (pl.provider === "ytmusic") {
        await rpc.request.ytmusicRenamePlaylist({
          playlistId: pl.providerId,
          name: newName.trim(),
        });
        void useLibraryStore.getState().syncYtMusicLibrary();
        return;
      }

      await rpc.request.renamePlaylist({
        oldPath: pl.path ?? pl.providerId,
        newName: newName.trim(),
      });
      await get().loadPlaylists();
    },

    deletePlaylist: async (playlistId) => {
      const rpc = getRpc();
      if (!rpc) return;
      const { playlists } = get();
      const pl = playlists.items.find((p) => p.id === playlistId);
      if (!pl) return;

      if (pl.provider === "ytmusic") {
        await rpc.request.ytmusicDeletePlaylist({ playlistId: pl.providerId });
        void useLibraryStore.getState().syncYtMusicLibrary();
        return;
      }

      if (pl.path) {
        await rpc.request.deletePlaylist({ path: pl.path });
        await get().loadPlaylists();
      }
    },

    addTrackToPlaylist: async (playlistId, track) => {
      const rpc = getRpc();
      if (!rpc) return;
      const { playlists } = get();
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
        const detailed = await rpc.request.ytmusicGetPlaylist({
          playlistId: pl.providerId,
        });
        if (detailed) {
          const updated = toPlaylist(detailed);

          // TODO: read library.source from libraryStore
          const librarySource = useLibraryStore.getState().library.source;

          set((s) => {
            const remoteItems = s.playlists.remoteItems.map((item) =>
              item.id === updated.id ? updated : item,
            );

            // Collect tracks to merge into libraryStore
            const remoteTracks = collectPlaylistTracks(remoteItems);
            useLibraryStore.getState().mergeRemoteTracks(remoteTracks);

            return {
              playlists: {
                ...s.playlists,
                remoteItems,
                items: mergePlaylists(
                  librarySource,
                  s.playlists.localItems,
                  remoteItems,
                ),
              },
            };
          });
        }
        return;
      }

      const localTracks = useLibraryStore.getState().library.localTracks;
      const entries = [...pl.trackIds, track.id]
        .map(
          (id) =>
            localTracks.find((localTrack) => localTrack.id === id)?.path,
        )
        .filter((value): value is string => Boolean(value));
      const dir = (pl.path ?? "").replace(/[/\\][^/\\]+$/, "");
      const name = pl.name.replace(/\.m3u8?$/, "");
      await rpc.request.savePlaylist({ path: dir, name, entries });
      await get().loadPlaylists();
    },

    removeTrackFromPlaylist: async (playlistId, trackId) => {
      const rpc = getRpc();
      if (!rpc) return;
      const { playlists } = get();
      const pl = playlists.items.find((p) => p.id === playlistId);
      if (!pl) return;

      if (pl.provider === "ytmusic") {
        const remoteTracks = useLibraryStore.getState().library.remoteTracks;
        const track = remoteTracks.find((item) => item.id === trackId);
        if (!track) return;
        await rpc.request.ytmusicRemoveTrackFromPlaylist({
          playlistId: pl.providerId,
          videoId: track.providerId,
        });
        const detailed = await rpc.request.ytmusicGetPlaylist({
          playlistId: pl.providerId,
        });
        if (detailed) {
          const updated = toPlaylist(detailed);

          // TODO: read library.source from libraryStore
          const librarySource = useLibraryStore.getState().library.source;

          set((s) => {
            const remoteItems = s.playlists.remoteItems.map((item) =>
              item.id === updated.id ? updated : item,
            );

            // Collect tracks to merge into libraryStore
            const newRemoteTracks = collectPlaylistTracks(remoteItems);
            useLibraryStore.getState().mergeRemoteTracks(newRemoteTracks);

            return {
              playlists: {
                ...s.playlists,
                remoteItems,
                items: mergePlaylists(
                  librarySource,
                  s.playlists.localItems,
                  remoteItems,
                ),
              },
            };
          });
        }
        return;
      }

      const localTracks = useLibraryStore.getState().library.localTracks;
      const entries = pl.trackIds
        .filter((id) => id !== trackId)
        .map(
          (id) =>
            localTracks.find((localTrack) => localTrack.id === id)?.path,
        )
        .filter((value): value is string => Boolean(value));
      const dir = (pl.path ?? "").replace(/[/\\][^/\\]+$/, "");
      const name = pl.name.replace(/\.m3u8?$/, "");
      await rpc.request.savePlaylist({ path: dir, name, entries });
      await get().loadPlaylists();
    },

    savePlaylistToLibrary: async (playlistId) => {
      const rpc = getRpc();
      if (!rpc) return;
      const providerId = playlistId.startsWith("ytmusic:")
        ? playlistId.slice(8)
        : playlistId;
      await rpc.request.ytmusicSavePlaylist({ playlistId: providerId });
      showToast("Playlist saved to your library");
      void useLibraryStore.getState().syncYtMusicLibrary();
    },

    unsavePlaylistFromLibrary: async (playlistId) => {
      const rpc = getRpc();
      if (!rpc) return;
      const providerId = playlistId.startsWith("ytmusic:")
        ? playlistId.slice(8)
        : playlistId;
      await rpc.request.ytmusicUnsavePlaylist({ playlistId: providerId });
      showToast("Playlist removed from your library");
      void useLibraryStore.getState().syncYtMusicLibrary();
    },

    loadPlaylistTracks: (playlistId) => {
      const { playlists } = get();
      const pl = playlists.items.find((p) => p.id === playlistId);
      if (!pl) return [];

      if (pl.tracks && pl.tracks.length > 0) {
        return pl.tracks;
      }

      const { localTracks, remoteTracks } = useLibraryStore.getState().library;

      const trackMap = new Map(
        [...localTracks, ...remoteTracks].map((track) => [track.id, track]),
      );
      const fromLibrary = pl.trackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is Track => t != null);
      if (fromLibrary.length > 0) {
        return fromLibrary;
      }

      if (
        pl.provider === "ytmusic" &&
        playlists.hydrationErrors[playlistId] &&
        !pl.tracks?.length
      ) {
        return [];
      }

      if (pl.provider === "ytmusic" && pl.trackIds.length > 0) {
        return pl.trackIds.map((id) => ytTrackStubFromId(id));
      }

      return [];
    },
  }),
);
