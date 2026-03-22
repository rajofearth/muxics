import { useCallback, useRef, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Search, X, Mic2, Disc3 } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import type { Track, NavView } from "../types";
import { TrackTable } from "./TrackTable";
import { HomeFeed } from "./HomeFeed";

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
  const albumMap = new Map<string, { artist: string; count: number; picture?: string }>();
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

export function SearchView({ currentTrack, isPlaying, onPlayTrack, onPlayPause, onNavigate }: SearchViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search, setSearchQuery, libraryTracks, librarySource, auth } = usePlayerStore(
    useShallow((s) => ({
      search: s.search,
      setSearchQuery: s.setSearchQuery,
      libraryTracks: s.library.tracks,
      librarySource: s.library.source,
      auth: s.auth,
    })),
  );

  const libraryMaps = useMemo(() => buildLibrarySearchMaps(libraryTracks), [libraryTracks]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    void setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  const artists = useMemo(() => {
    if (!search.query) return [];
    const q = search.query.toLowerCase();
    const out: { name: string; count: number; picture?: string }[] = [];
    for (const [name, data] of libraryMaps.artistMap) {
      if (name.toLowerCase().includes(q)) {
        out.push({ name, ...data });
      }
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }, [search.query, libraryMaps.artistMap]);

  const albums = useMemo(() => {
    if (!search.query) return [];
    const q = search.query.toLowerCase();
    const out: { name: string; artist: string; count: number; picture?: string }[] = [];
    for (const [name, data] of libraryMaps.albumMap) {
      if (name.toLowerCase().includes(q)) {
        out.push({ name, ...data });
      }
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }, [search.query, libraryMaps.albumMap]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-6 pb-4 shrink-0">
        <div className="relative max-w-xl">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-app-text-tertiary" />
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
            className="w-full pl-11 pr-10 py-3 bg-app-elevated rounded-xl text-[14px] text-app-text-primary placeholder-app-text-tertiary border border-app-border focus:border-app-text-tertiary outline-none"
          />
          {search.query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-tertiary hover:text-app-text-primary p-1 rounded-md hover:bg-app-hover"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!search.query ? (
        <HomeFeed onNavigate={onNavigate} />
      ) : search.loading &&
        artists.length === 0 &&
        albums.length === 0 &&
        search.results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary gap-2">
          <div className="w-8 h-8 border-2 border-app-text-tertiary border-t-app-text-primary rounded-full animate-spin" />
          <div className="text-sm">Searching...</div>
        </div>
      ) : search.results.length === 0 && artists.length === 0 && albums.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-app-text-tertiary gap-2">
          <div className="text-sm">No results for "{search.query}"</div>
          <div className="text-xs">{search.error ?? "Try a different search term"}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {search.loading && (
            <div className="px-8 pt-2 text-[12px] text-app-text-tertiary flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-app-text-tertiary border-t-app-text-primary rounded-full animate-spin shrink-0" />
              Updating YouTube Music results…
            </div>
          )}
          {artists.length > 0 && (
            <div className="px-8 py-3">
              <h3 className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-3">
                Artists
              </h3>
              <div className="flex gap-2 flex-wrap">
                {artists.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => onNavigate?.("artist_detail", a.name)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-app-elevated hover:bg-app-active text-[13px] transition-colors"
                  >
                    {a.picture ? (
                      <img src={a.picture} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-app-border-strong flex items-center justify-center">
                        <Mic2 size={12} className="text-app-text-tertiary" />
                      </div>
                    )}
                    <span className="text-app-text-primary font-medium">{a.name}</span>
                    <span className="text-app-text-tertiary text-[11px]">{a.count} songs</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {albums.length > 0 && (
            <div className="px-8 py-3">
              <h3 className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-3">
                Albums
              </h3>
              <div className="flex gap-2 flex-wrap">
                {albums.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => onNavigate?.("album_detail", a.name)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-app-elevated hover:bg-app-active text-[13px] transition-colors"
                  >
                    {a.picture ? (
                      <img src={a.picture} alt="" className="w-7 h-7 rounded object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded bg-app-border-strong flex items-center justify-center">
                        <Disc3 size={12} className="text-app-text-tertiary" />
                      </div>
                    )}
                    <span className="text-app-text-primary font-medium">{a.name}</span>
                    <span className="text-app-text-tertiary text-[11px]">{a.artist}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {search.results.length > 0 && (
            <div className="mt-1 flex-1 flex flex-col min-h-0">
              <div className="px-8 py-2 shrink-0">
                <h3 className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider">
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
