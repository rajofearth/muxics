import { useCallback, useRef, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Search, X, Mic2, Disc3, Play, ListMusic } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAuthStore } from "../store/authStore";
import type { Track, NavView, Playlist } from "../types";
import { TrackTable } from "./TrackTable";
import { HomeFeed } from "./HomeFeed";
import { bench } from "../bench";

type SearchViewProps = {
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onPlayPause: () => void;
  onNavigate?: (view: NavView, id?: string) => void;
};

/** Single pass over tracks for artist/album suggestion chips (rebuilt when library changes). */
function buildLibrarySearchMaps(tracks: readonly Track[]) {
  const artistMap = new Map<string, { count: number; picture?: string }>();
  const albumMap = new Map<
    string,
    { artist: string; count: number; picture?: string }
  >();
  for (const t of tracks) {
    const artist = t.artist || "Unknown Artist";
    const ae = artistMap.get(artist);
    if (ae) {
      ae.count += 1;
      if (!ae.picture && t.picture) ae.picture = t.picture;
    } else {
      artistMap.set(artist, { count: 1, picture: t.picture });
    }
    const alb = t.album?.trim();
    if (alb) {
      const al = albumMap.get(alb);
      if (al) {
        al.count += 1;
        if (!al.picture && t.picture) al.picture = t.picture;
      } else {
        albumMap.set(alb, { artist: t.artist, count: 1, picture: t.picture });
      }
    }
  }
  return { artistMap, albumMap };
}

export function SearchView({
  currentTrack,
  isPlaying,
  onPlayTrack,
  onPlayPause,
  onNavigate,
}: SearchViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search, setSearchQuery } = useUiStore(
    useShallow((s) => ({
      search: s.search,
      setSearchQuery: s.setSearchQuery,
    })),
  );
  const { libraryTracks, librarySource } = useLibraryStore(
    useShallow((s) => ({
      libraryTracks: s.library.tracks,
      librarySource: s.library.source,
    })),
  );
  const auth = useAuthStore((s) => s.auth);

  const libraryMaps = useMemo(
    () => buildLibrarySearchMaps(libraryTracks),
    [libraryTracks],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Bench: search:results — post-frame after the search outcome renders
  // (design §2.3). Pairs with the search:input mark emitted in uiStore's
  // setSearchQuery; the measure is keystroke → results painted. Fires when
  // the query settles (loading false), zero-result searches included.
  useEffect(() => {
    if (!bench.enabled || !search.query || search.loading) {
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        bench.mark("search:results");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [search.query, search.loading]);

  const handleClear = useCallback(() => {
    void setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  const localArtists = useMemo(() => {
    if (!search.query) return [];
    const q = search.query.toLowerCase();
    const out: { name: string; count: number; picture?: string }[] = [];
    for (const [name, data] of libraryMaps.artistMap) {
      if (name.toLowerCase().includes(q)) {
        out.push({ name, ...data });
      }
    }
    return out
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [search.query, libraryMaps.artistMap]);

  const handleItemClick = useCallback(
    (item: Track | Playlist) => {
      if ("title" in item) {
        onPlayTrack(item, search.results);
      } else if (onNavigate) {
        const view = item.type === "album" ? "album_detail" : "playlist_detail";
        onNavigate(view, item.id);
      }
    },
    [onPlayTrack, search.results, onNavigate],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app-bg">
      <div className="px-8 pt-6 pb-4 shrink-0">
        <div className="relative max-w-xl">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-app-text-tertiary"
          />
          <input
            ref={inputRef}
            type="text"
            value={search.query}
            onChange={(e) => void setSearchQuery(e.target.value)}
            placeholder={
              auth.loggedIn && librarySource !== "local"
                ? "Songs, artists, albums on YouTube Music..."
                : "Songs, artists, albums..."
            }
            className="w-full pl-11 pr-10 py-3 bg-app-elevated rounded-xl text-[14px] text-app-text-primary placeholder-app-text-tertiary border border-app-border focus:border-app-text-tertiary outline-none transition-all shadow-sm"
          />
          {search.query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-tertiary hover:text-app-text-primary p-1 rounded-md hover:bg-app-hover transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!search.query ? (
        <HomeFeed onNavigate={onNavigate} />
      ) : search.loading &&
        localArtists.length === 0 &&
        (search.albums?.length ?? 0) === 0 &&
        (search.playlists?.length ?? 0) === 0 &&
        search.results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary gap-4">
          <div className="w-8 h-8 border-2 border-app-accent border-t-transparent rounded-full animate-spin" />
          <div className="text-sm font-medium">Searching...</div>
        </div>
      ) : search.results.length === 0 &&
        localArtists.length === 0 &&
        (search.albums?.length ?? 0) === 0 &&
        (search.playlists?.length ?? 0) === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary gap-2">
          <div className="text-sm">No results for "{search.query}"</div>
          <div className="text-xs">
            {search.error ?? "Try a different search term"}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 no-scrollbar pb-12">
          {search.loading && (
            <div className="px-8 pt-2 text-[12px] text-app-text-tertiary flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-app-accent border-t-transparent rounded-full animate-spin shrink-0" />
              Updating results…
            </div>
          )}

          {localArtists.length > 0 && (
            <div className="px-8 py-4">
              <h3 className="text-[11px] font-semibold text-app-text-tertiary uppercase tracking-wider mb-4">
                Artists
              </h3>
              <div className="flex gap-3 flex-wrap">
                {localArtists.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => onNavigate?.("artist_detail", a.name)}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-app-surface hover:bg-app-hover border border-app-border text-[13px] transition-all shadow-sm group"
                  >
                    {a.picture ? (
                      <img
                        src={a.picture}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-app-border flex items-center justify-center">
                        <Mic2 size={14} className="text-app-text-tertiary" />
                      </div>
                    )}
                    <div className="text-left">
                      <div className="text-app-text-primary font-semibold">
                        {a.name}
                      </div>
                      <div className="text-app-text-tertiary text-[11px]">
                        {a.count} songs
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {search.albums && search.albums.length > 0 && (
            <div className="py-4">
              <div className="px-8 mb-4">
                <h3 className="text-[11px] font-semibold text-app-text-tertiary uppercase tracking-wider">
                  Albums
                </h3>
              </div>
              <div className="flex overflow-x-auto gap-4 px-8 pb-4 scroll-smooth scrollbar-none snap-x">
                {search.albums.map((album) => (
                  <button
                    key={album.id}
                    onClick={() => handleItemClick(album)}
                    className="group flex-shrink-0 w-[150px] text-left transition-all snap-start"
                  >
                    <div className="aspect-square rounded-xl bg-app-elevated mb-3 overflow-hidden shadow-md group-hover:shadow-xl transition-all relative ring-1 ring-inset ring-white/5">
                      {album.picture ? (
                        <img
                          src={album.picture}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-app-border">
                          <Disc3 className="text-app-text-tertiary w-1/3 h-1/3 opacity-40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                        <div className="w-10 h-10 rounded-full bg-app-text-primary flex items-center justify-center translate-y-2 group-hover:translate-y-0 transition-transform shadow-2xl">
                          <Play
                            size={18}
                            className="fill-app-bg text-app-bg ml-1"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold text-app-text-primary line-clamp-1 leading-tight mb-1">
                      {album.name}
                    </div>
                    <div className="text-[11.5px] text-app-text-tertiary line-clamp-1">
                      {album.author}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {search.playlists && search.playlists.length > 0 && (
            <div className="py-4">
              <div className="px-8 mb-4">
                <h3 className="text-[11px] font-semibold text-app-text-tertiary uppercase tracking-wider">
                  Playlists
                </h3>
              </div>
              <div className="flex overflow-x-auto gap-4 px-8 pb-4 scroll-smooth scrollbar-none snap-x">
                {search.playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => handleItemClick(pl)}
                    className="group flex-shrink-0 w-[150px] text-left transition-all snap-start"
                  >
                    <div className="aspect-square rounded-lg bg-app-elevated mb-3 overflow-hidden shadow-md group-hover:shadow-xl transition-all relative ring-1 ring-inset ring-white/5">
                      {pl.picture ? (
                        <img
                          src={pl.picture}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-app-border">
                          <ListMusic className="text-app-text-tertiary w-1/3 h-1/3 opacity-40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                        <div className="w-10 h-10 rounded-full bg-app-text-primary flex items-center justify-center translate-y-2 group-hover:translate-y-0 transition-transform shadow-2xl">
                          <ListMusic size={18} className="text-app-bg" />
                        </div>
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold text-app-text-primary line-clamp-1 leading-tight mb-1">
                      {pl.name}
                    </div>
                    <div className="text-[11.5px] text-app-text-tertiary line-clamp-1">
                      {pl.author}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {search.results.length > 0 && (
            <div className="mt-2 flex-1 flex flex-col min-h-0">
              <div className="px-8 py-3 shrink-0">
                <h3 className="text-[11px] font-semibold text-app-text-tertiary uppercase tracking-wider">
                  Songs ({search.results.length})
                </h3>
              </div>
              <TrackTable
                tracks={search.results}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onTrackClick={onPlayTrack}
                onActiveTrackClick={onPlayPause}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
