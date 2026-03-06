import { useMemo, useState } from "react";
import {
  ArrowRight,
  Disc3,
  FolderOpen,
  Heart,
  LibraryBig,
  ListMusic,
  Music4,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { Track, NavState, NavView } from "./types";
import { usePlayerStore } from "./store/playerStore";
import { formatTotalDuration } from "./utils";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { TrackTable } from "./components/TrackTable";
import { FoldersView } from "./components/FoldersView";
import { EmptyLibrary } from "./components/EmptyLibrary";
import { PlaylistHeaderActions } from "./components/PlaylistHeaderActions";

type WinampElectrobun = {
  rpc?: {
    send?: {
      resizeWindow: (p: { width: number; height: number }) => void;
      closeWindow: () => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
    };
  };
};

type MainWindowProps = {
  electrobun?: WinampElectrobun;
  onToggleMini?: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  playQueue: Track[];
  currentTimeMs: number;
  volume: number;
  onPlayTrack: (track: Track, queue: Track[] | null) => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
};

export function MainWindow({
  electrobun,
  onToggleMini,
  currentTrack,
  isPlaying,
  playQueue,
  currentTimeMs,
  volume,
  onPlayTrack,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
}: MainWindowProps) {
  const [navState, setNavState] = useState<NavState>({ view: "home", id: undefined });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("ALL");
  const [sortBy, setSortBy] = useState<"title" | "artist" | "album" | "duration">("title");

  const {
    library,
    playlists,
    preferences,
    player,
    loadPlaylistTracks,
    settings,
    toggleLikedTrack,
    loadLibrary,
  } = usePlayerStore();
  const likedTrackPaths = preferences.likedTrackPaths;

  const handleNavigate = (view: NavView, id?: string) => {
    setNavState({ view, id });
    setActiveGenre("ALL");
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const artists = useMemo(
    () =>
      [...new Set(library.tracks.map((track) => track.artist))]
        .filter(Boolean)
        .map((name) => {
          const artistTracks = library.tracks.filter((track) => track.artist === name);
          return {
            id: name,
            name,
            desc: `${artistTracks.length} tracks • ${formatTotalDuration(artistTracks)}`,
          };
        }),
    [library.tracks]
  );

  const albums = useMemo(() => {
    const albumMap = new Map<string, Track[]>();
    for (const track of library.tracks) {
      const key = `${track.artist}::${track.album}`;
      const existing = albumMap.get(key) ?? [];
      existing.push(track);
      albumMap.set(key, existing);
    }

    return [...albumMap.entries()].map(([id, tracks]) => ({
      id,
      name: tracks[0]?.album ?? "Unknown Album",
      artist: tracks[0]?.artist ?? "Unknown Artist",
      tracks,
      desc: `${tracks.length} tracks • ${formatTotalDuration(tracks)}`,
    }));
  }, [library.tracks]);

  const likedTracks = useMemo(
    () => library.tracks.filter((track) => likedTrackPaths.includes(track.path)),
    [library.tracks, likedTrackPaths]
  );

  const recentTracks = useMemo(() => {
    const trackMap = new Map(library.tracks.map((track) => [track.path, track]));
    return preferences.recentPlays
      .map((entry) => trackMap.get(entry.path))
      .filter((track): track is Track => !!track);
  }, [library.tracks, preferences.recentPlays]);

  const topGenres = useMemo(
    () =>
      ["ALL", ...new Set(library.tracks.map((track) => track.genre).filter(Boolean))]
        .slice(0, 8),
    [library.tracks]
  );

  const applyTrackFilters = (tracks: Track[]) => {
    const filteredTracks = tracks.filter((track) => {
      if (activeGenre !== "ALL" && track.genre !== activeGenre) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = `${track.title} ${track.artist} ${track.album} ${track.genre}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });

    return [...filteredTracks].sort((left, right) => {
      switch (sortBy) {
        case "artist":
          return left.artist.localeCompare(right.artist) || left.title.localeCompare(right.title);
        case "album":
          return left.album.localeCompare(right.album) || left.title.localeCompare(right.title);
        case "duration":
          return right.duration - left.duration || left.title.localeCompare(right.title);
        case "title":
        default:
          return left.title.localeCompare(right.title);
      }
    });
  };

  const filteredLibraryTracks = useMemo(
    () => applyTrackFilters(library.tracks),
    [activeGenre, library.tracks, normalizedSearch, sortBy]
  );
  const filteredRecentTracks = useMemo(
    () => applyTrackFilters(recentTracks),
    [activeGenre, normalizedSearch, recentTracks, sortBy]
  );
  const filteredLikedTracks = useMemo(
    () => applyTrackFilters(likedTracks),
    [activeGenre, likedTracks, normalizedSearch, sortBy]
  );
  const filteredQueueTracks = useMemo(
    () => applyTrackFilters(playQueue),
    [activeGenre, normalizedSearch, playQueue, sortBy]
  );

  const renderSectionHeader = (
    eyebrow: string,
    title: string,
    description: string,
    actions?: React.ReactNode
  ) => (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">{eyebrow}</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/48">{description}</p>
      </div>
      {actions}
    </div>
  );

  const renderStats = () => (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        {
          label: "Tracks",
          value: library.tracks.length.toString(),
          detail: formatTotalDuration(library.tracks),
        },
        {
          label: "Favorites",
          value: likedTracks.length.toString(),
          detail: "Pinned for quick access",
        },
        {
          label: "Playlists",
          value: playlists.items.length.toString(),
          detail: settings.watchFolders.length > 0 ? `${settings.watchFolders.length} folders watched` : "Add a folder",
        },
      ].map((item) => (
        <div
          key={item.label}
          className="rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-5 shadow-[0_20px_70px_rgba(3,8,18,0.34)]"
        >
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">{item.label}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{item.value}</div>
          <div className="mt-2 text-sm text-white/45">{item.detail}</div>
        </div>
      ))}
    </div>
  );

  const renderGridCards = (
    items: { id: string; name: string; desc: string; artist?: string }[],
    onItemClick: (itemId: string) => void
  ) => (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onItemClick(item.id)}
          className="rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/6"
        >
          <div className="flex items-center justify-between">
            <div className="rounded-2xl bg-white/8 p-3 text-sky-300">
              <Disc3 size={18} />
            </div>
            <ArrowRight size={16} className="text-white/28" />
          </div>
          <div className="mt-5 text-lg font-medium text-white">{item.name}</div>
          {item.artist && <div className="mt-1 text-sm text-white/45">{item.artist}</div>}
          <div className="mt-4 text-sm text-white/45">{item.desc}</div>
        </button>
      ))}
    </div>
  );

  const renderHome = () => (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <div className="rounded-[32px] border border-white/8 bg-[linear-gradient(135deg,rgba(32,66,116,0.42),rgba(12,18,28,0.9))] p-6 shadow-[0_24px_80px_rgba(3,8,18,0.36)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
                <Sparkles size={14} className="text-sky-300" />
                Designed for focus
              </div>
              <h1 className="mt-4 text-4xl font-semibold text-white">
                Minimal desktop listening for deep work and quick sessions.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/54">
                Browse fast, keep a clean queue, and jump back into the tracks you actually play.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleNavigate("library")}
              className="rounded-full border border-white/12 bg-white/8 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/12"
            >
              Open library
            </button>
          </div>

          {currentTrack && (
            <div className="mt-8 flex flex-wrap items-center gap-4 rounded-[28px] border border-white/8 bg-black/18 p-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[24px] bg-white/8">
                {currentTrack.picture ? (
                  <img src={currentTrack.picture} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Music4 size={24} className="text-white/30" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.22em] text-white/35">Now playing</div>
                <div className="mt-2 truncate text-2xl font-semibold text-white">{currentTrack.title}</div>
                <div className="mt-1 truncate text-sm text-white/50">
                  {currentTrack.artist} • {currentTrack.album}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleLikedTrack(currentTrack)}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition ${
                  likedTrackPaths.includes(currentTrack.path)
                    ? "bg-rose-400/16 text-rose-300"
                    : "bg-white/8 text-white/50 hover:text-white"
                }`}
                aria-label="Toggle favorite"
              >
                <Heart
                  size={16}
                  className={likedTrackPaths.includes(currentTrack.path) ? "fill-rose-400 text-rose-400" : ""}
                />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">{renderStats()}</div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          {renderSectionHeader(
            "Recently played",
            "Jump back in",
            "Your latest listens stay one tap away."
          )}
          <TrackTable
            tracks={recentTracks.slice(0, 8)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            likedTrackPaths={likedTrackPaths}
            showAlbumColumn={false}
            emptyTitle="No listening history yet"
            emptyDescription="Play a few tracks and they will appear here."
            onTrackClick={(track, queue) => onPlayTrack(track, queue)}
          />
        </div>

        <div>
          {renderSectionHeader(
            "Favorites",
            "Tracks worth keeping nearby",
            "Pin songs you come back to often."
          )}
          <TrackTable
            tracks={likedTracks.slice(0, 8)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            likedTrackPaths={likedTrackPaths}
            showAlbumColumn={false}
            emptyTitle="No favorites yet"
            emptyDescription="Use the heart icon on any track to keep it here."
            onTrackClick={(track, queue) => onPlayTrack(track, queue)}
          />
        </div>
      </div>
    </div>
  );

  const renderMainContent = () => {
    if (library.loading) {
      return (
        <div className="flex flex-1 items-center justify-center text-white/42">
          <div className="text-center">
            <div className="text-lg">Scanning your library...</div>
            <div className="mt-2 text-sm">Caching metadata and preparing the queue.</div>
          </div>
        </div>
      );
    }

    if (library.tracks.length === 0 && !library.error && settings.watchFolders.length === 0) {
      return <EmptyLibrary />;
    }

    if (library.error) {
      return (
        <div className="flex flex-1 items-center justify-center text-white/42">
          <div className="text-center">
            <div className="text-lg text-red-300">We hit a library error</div>
            <div className="mt-2 text-sm text-white/55">{library.error}</div>
            <button
              type="button"
              onClick={() => loadLibrary()}
              className="mt-5 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white transition hover:bg-white/12"
            >
              Retry scan
            </button>
          </div>
        </div>
      );
    }

    if (library.tracks.length === 0 && settings.watchFolders.length > 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-white/42">
          <div className="text-center">
            <div className="text-lg">No audio files found</div>
            <div className="mt-2 text-sm">Add another folder or check the files inside your library.</div>
            <button
              type="button"
              onClick={() => handleNavigate("folders")}
              className="mt-5 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white transition hover:bg-white/12"
            >
              Manage folders
            </button>
          </div>
        </div>
      );
    }

    switch (navState.view) {
      case "home":
        return renderHome();

      case "library":
        return (
          <div>
            {renderSectionHeader(
              "Library",
              "All songs",
              `${filteredLibraryTracks.length} tracks • ${formatTotalDuration(filteredLibraryTracks)}`
            )}
            <TrackTable
              tracks={filteredLibraryTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              emptyTitle="No songs match this search"
              emptyDescription="Try changing your search, genre, or sort order."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );

      case "artists":
        return (
          <div>
            {renderSectionHeader(
              "Artists",
              "Browse by artist",
              `${artists.length} artists across your library`
            )}
            {renderGridCards(
              artists.filter((artist) => artist.name.toLowerCase().includes(normalizedSearch)),
              (artistId) => handleNavigate("artist_detail", artistId)
            )}
          </div>
        );

      case "artist_detail": {
        const artistTracks = library.tracks.filter((t) => t.artist === navState.id);
        return (
          <div>
            {renderSectionHeader(
              "Artist",
              navState.id ?? "Artist",
              `${artistTracks.length} tracks • ${formatTotalDuration(artistTracks)}`
            )}
            <TrackTable
              tracks={applyTrackFilters(artistTracks)}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              showArtistColumn={false}
              emptyTitle="No tracks for this artist"
              emptyDescription="Try a different search or scan more folders."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );
      }

      case "albums":
        return (
          <div>
            {renderSectionHeader(
              "Albums",
              "Browse by release",
              `${albums.length} albums in your collection`
            )}
            {renderGridCards(
              albums.filter((album) => {
                if (!normalizedSearch) {
                  return true;
                }
                return `${album.name} ${album.artist}`.toLowerCase().includes(normalizedSearch);
              }),
              (albumId) => handleNavigate("album_detail", albumId)
            )}
          </div>
        );

      case "album_detail": {
        const album = albums.find((entry) => entry.id === navState.id);
        const albumTracks = album?.tracks ?? [];
        return (
          <div>
            {renderSectionHeader(
              "Album",
              album?.name ?? "Album",
              album ? `${album.artist} • ${albumTracks.length} tracks` : "Album not found"
            )}
            <TrackTable
              tracks={applyTrackFilters(albumTracks)}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              showAlbumColumn={false}
              emptyTitle="No tracks for this album"
              emptyDescription="Try changing your search or rescan the library."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );
      }

      case "playlists":
        return (
          <div>
            {renderSectionHeader(
              "Playlists",
              "Curated collections",
              `${playlists.items.length} playlists ready to play`
            )}
            {renderGridCards(
              playlists.items
                .map((playlist) => ({
                  id: playlist.id,
                  name: playlist.name,
                  desc: `${playlist.trackIds.length} tracks`,
                }))
                .filter((playlist) => playlist.name.toLowerCase().includes(normalizedSearch)),
              (playlistId) => handleNavigate("playlist_detail", playlistId)
            )}
          </div>
        );

      case "playlist_detail": {
        const plTracks = loadPlaylistTracks(navState.id ?? "");
        const activePlaylist = playlists.items.find((p) => p.id === navState.id);
        return (
          <div>
            {renderSectionHeader(
              "Playlist",
              activePlaylist?.name ?? "Playlist",
              `${plTracks.length} tracks • ${formatTotalDuration(plTracks)}`,
              activePlaylist ? (
                <PlaylistHeaderActions playlist={activePlaylist} onNavigate={handleNavigate} />
              ) : null
            )}
            <TrackTable
              tracks={applyTrackFilters(plTracks)}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              playlistId={activePlaylist?.id}
              emptyTitle="This playlist is empty"
              emptyDescription="Use the track context menu to add songs into it."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );
      }

      case "folders":
        return <FoldersView />;

      case "favorites":
        return (
          <div>
            {renderSectionHeader(
              "Favorites",
              "Your liked tracks",
              `${filteredLikedTracks.length} tracks you marked for quick return`
            )}
            <TrackTable
              tracks={filteredLikedTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              emptyTitle="No favorites yet"
              emptyDescription="Tap the heart beside any track to keep it here."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );

      case "recent":
        return (
          <div>
            {renderSectionHeader(
              "History",
              "Recently played",
              `${filteredRecentTracks.length} tracks from your latest sessions`
            )}
            <TrackTable
              tracks={filteredRecentTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              emptyTitle="No history yet"
              emptyDescription="Start playing music and your recent tracks will appear here."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );

      case "queue":
      default: {
        return (
          <div>
            {renderSectionHeader(
              "Queue",
              "Up next",
              `${filteredQueueTracks.length} tracks queued`,
              playQueue.length > 0 ? (
                <button
                  type="button"
                  onClick={() => usePlayerStore.getState().clearQueue()}
                  className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white transition hover:bg-white/12"
                >
                  Clear queue
                </button>
              ) : null
            )}
            <TrackTable
              tracks={filteredQueueTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              likedTrackPaths={likedTrackPaths}
              queueMode
              emptyTitle="Queue is empty"
              emptyDescription="Right-click tracks to add them to the queue."
              onTrackClick={(track, queue) => onPlayTrack(track, queue)}
            />
          </div>
        );
      }
    }
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#172235_0%,#0c111b_38%,#070b12_100%)] text-white font-mono">
      <TitleBar electrobun={electrobun} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          navState={navState}
          playlists={playlists.items}
          trackCount={library.tracks.length}
          onNavigate={handleNavigate}
        />
        <div className="flex min-w-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-white/8 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-[320px] flex-1 items-center gap-3 rounded-full border border-white/8 bg-white/4 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <Search size={16} className="text-white/35" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search songs, artists, albums, and genres"
                    className="w-full bg-transparent text-sm text-white placeholder:text-white/32 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(event.target.value as "title" | "artist" | "album" | "duration")
                    }
                    className="rounded-full border border-white/8 bg-white/4 px-4 py-2.5 text-sm text-white outline-none"
                  >
                    <option value="title">Sort by title</option>
                    <option value="artist">Sort by artist</option>
                    <option value="album">Sort by album</option>
                    <option value="duration">Sort by duration</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => loadLibrary()}
                    className="flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-4 py-2.5 text-sm text-white transition hover:bg-white/8"
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {topGenres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => setActiveGenre(genre)}
                    className={`rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition ${
                      activeGenre === genre
                        ? "bg-sky-400/15 text-sky-300"
                        : "bg-white/4 text-white/45 hover:bg-white/8 hover:text-white/72"
                    }`}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{renderMainContent()}</div>
          </main>

          <aside className="hidden w-[340px] shrink-0 border-l border-white/8 bg-[rgba(9,14,22,0.46)] p-5 xl:block">
            <div className="space-y-5">
              <div className="rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/38">
                  <LibraryBig size={14} className="text-sky-300" />
                  Now playing
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[24px] bg-white/6">
                    {currentTrack?.picture ? (
                      <img src={currentTrack.picture} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Music4 size={18} className="text-white/28" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-white">
                      {currentTrack?.title ?? "Nothing playing"}
                    </div>
                    <div className="mt-1 truncate text-sm text-white/45">
                      {currentTrack ? `${currentTrack.artist} • ${currentTrack.album}` : "Choose a track to start."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/38">
                  <ListMusic size={14} className="text-violet-300" />
                  Up next
                </div>
                <div className="mt-4 space-y-2">
                  {(playQueue.length > 0 ? playQueue : library.tracks)
                    .filter((track) => track.path !== currentTrack?.path)
                    .slice(0, 6)
                    .map((track) => (
                      <button
                        key={track.path}
                        type="button"
                        onClick={() => onPlayTrack(track, playQueue.length > 0 ? playQueue : library.tracks)}
                        className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/6"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white/78">{track.title}</div>
                          <div className="truncate text-xs text-white/38">{track.artist}</div>
                        </div>
                        <div className="ml-4 text-xs text-white/38">{track.time}</div>
                      </button>
                    ))}
                  {playQueue.length === 0 && (
                    <div className="text-sm text-white/42">Right-click any track to add it to the queue.</div>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/38">
                  <FolderOpen size={14} className="text-emerald-300" />
                  Library status
                </div>
                <div className="mt-4 space-y-2 text-sm text-white/48">
                  <div>{settings.watchFolders.length} folders watched</div>
                  <div>{library.tracks.length} tracks available</div>
                  <div>{playlists.items.length} playlists ready</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTimeMs={currentTimeMs}
        volume={volume}
        queueLength={player.queue.length}
        isLiked={!!currentTrack && likedTrackPaths.includes(currentTrack.path)}
        shuffleEnabled={player.shuffleEnabled}
        repeatMode={player.repeatMode}
        onPlayPause={onPlayPause}
        onNext={onNext}
        onPrev={onPrev}
        onScrubberChange={onScrubberChange}
        onVolumeChange={onVolumeChange}
        onToggleLike={() => currentTrack && toggleLikedTrack(currentTrack)}
        onToggleShuffle={() => usePlayerStore.getState().toggleShuffle()}
        onCycleRepeatMode={() => usePlayerStore.getState().cycleRepeatMode()}
        onToggleMini={onToggleMini}
      />
    </div>
  );
}
