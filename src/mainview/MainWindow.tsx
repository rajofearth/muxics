import { useState, useMemo, useCallback, useEffect } from "react";
import type { Track, NavState, NavView } from "./types";
import { usePlayerStore } from "./store/playerStore";
import { formatTotalDuration } from "./utils";
import { Library, Mic2, Disc3, ListMusic, Music, Play, Heart, Shuffle } from "lucide-react";
import { shuffleArray } from "./utils";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { HeroHeader } from "./components/HeroHeader";
import { TabNav } from "./components/TabNav";
import { TrackTable } from "./components/TrackTable";
import { GridView } from "./components/GridView";
import { FoldersView } from "./components/FoldersView";
import { EmptyLibrary } from "./components/EmptyLibrary";
import { PlaylistHeaderActions } from "./components/PlaylistHeaderActions";
import { SearchView } from "./components/SearchView";
import { QueueView } from "./components/QueueView";
import { NowPlayingView } from "./components/NowPlayingView";

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
  currentTime: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  onPlayTrack: (track: Track, queue: Track[] | null) => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
};

export function MainWindow({
  electrobun,
  onToggleMini,
  currentTrack,
  isPlaying,
  playQueue,
  currentTime,
  volume,
  shuffle,
  repeat,
  onPlayTrack,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
  onToggleShuffle,
  onCycleRepeat,
}: MainWindowProps) {
  const [navState, setNavState] = useState<NavState>({ view: "library", id: undefined });
  const [activeTab, setActiveTab] = useState<string>("All");

  const { library, playlists, loadPlaylistTracks, settings, recentlyPlayed, getFavoriteTracks } = usePlayerStore();

  const handleNavigate = useCallback((view: NavView, id?: string) => {
    setNavState({ view, id });
    setActiveTab("All");
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          onPlayPause();
          break;
        case "ArrowRight":
          if (e.metaKey || e.ctrlKey) { onNext(); e.preventDefault(); }
          break;
        case "ArrowLeft":
          if (e.metaKey || e.ctrlKey) { onPrev(); e.preventDefault(); }
          break;
        case "ArrowUp":
          if (e.metaKey || e.ctrlKey) { onVolumeChange(Math.min(1, volume + 0.05)); e.preventDefault(); }
          break;
        case "ArrowDown":
          if (e.metaKey || e.ctrlKey) { onVolumeChange(Math.max(0, volume - 0.05)); e.preventDefault(); }
          break;
        case "f":
        case "F":
          if (e.metaKey || e.ctrlKey) { handleNavigate("search"); e.preventDefault(); }
          break;
        case "Escape":
          if (navState.view === "now_playing") { handleNavigate("library"); e.preventDefault(); }
          else if (navState.view === "artist_detail") { handleNavigate("artists"); e.preventDefault(); }
          else if (navState.view === "album_detail") { handleNavigate("albums"); e.preventDefault(); }
          else if (navState.view === "playlist_detail") { handleNavigate("playlists"); e.preventDefault(); }
          else if (navState.view === "search") { handleNavigate("library"); e.preventDefault(); }
          break;
        case "l":
        case "L":
          if (e.metaKey || e.ctrlKey) {
            handleNavigate("library");
            e.preventDefault();
          }
          break;
        case "n":
        case "N":
          if (e.metaKey || e.ctrlKey) {
            if (currentTrack) handleNavigate("now_playing");
            e.preventDefault();
          }
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onPlayPause, onNext, onPrev, onVolumeChange, volume, handleNavigate]);

  const artists = useMemo(
    () =>
      [...new Set(library.tracks.map((t) => t.artist))].map((name) => {
        const tracks = library.tracks.filter((t) => t.artist === name);
        return {
          id: name,
          name,
          desc: `${tracks.length} songs`,
          picture: tracks.find((t) => t.picture)?.picture,
        };
      }),
    [library.tracks]
  );

  const albums = useMemo(
    () =>
      [...new Set(library.tracks.map((t) => t.album))].filter(Boolean).map((name) => {
        const tracks = library.tracks.filter((t) => t.album === name);
        return {
          id: name,
          name,
          desc: tracks[0]?.artist ?? "",
          picture: tracks.find((t) => t.picture)?.picture,
        };
      }),
    [library.tracks]
  );

  const handlePlayAll = useCallback(
    (tracks: Track[]) => {
      if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
    },
    [onPlayTrack]
  );

  const handleShufflePlay = useCallback(
    (tracks: Track[]) => {
      if (tracks.length > 0) {
        const shuffled = shuffleArray(tracks);
        onPlayTrack(shuffled[0], shuffled);
      }
    },
    [onPlayTrack]
  );

  const renderTrackView = (
    title: string,
    subtitle: string,
    tracks: Track[],
    icon: React.ReactNode,
    extraActions?: React.ReactNode,
    playlistId?: string,
    onBack?: () => void
  ) => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <HeroHeader
        title={title}
        subtitle={subtitle}
        meta={`${tracks.length} songs · ${formatTotalDuration(tracks)}`}
        icon={icon}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            {tracks.length > 0 && (
              <>
                <button
                  onClick={() => handlePlayAll(tracks)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-app-text-primary text-app-bg rounded-full text-[12px] font-medium hover:opacity-90"
                >
                  <Play size={12} className="fill-current" /> Play
                </button>
                <button
                  onClick={() => handleShufflePlay(tracks)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-app-elevated hover:bg-app-active text-app-text-primary rounded-full text-[12px] font-medium border border-app-border-strong"
                >
                  <Shuffle size={12} /> Shuffle
                </button>
              </>
            )}
            {extraActions}
          </div>
        }
      />
      <TabNav
        tabs={["All", ...Array.from(new Set(tracks.map((t) => t.genre).filter(Boolean)))]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <TrackTable
        tracks={activeTab === "All" ? tracks : tracks.filter((t) => t.genre === activeTab)}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onTrackClick={(track, queue) => onPlayTrack(track, queue)}
        playlistId={playlistId}
      />
    </div>
  );

  const renderMainContent = () => {
    if (library.loading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center w-64">
            <div className="w-10 h-10 border-2 border-app-text-tertiary border-t-app-text-primary rounded-full animate-spin mx-auto mb-4" />
            <div className="text-[14px] text-app-text-primary mb-3">Scanning library...</div>
            {library.scanProgress > 0 && (
              <div>
                <div className="h-1 bg-app-border-strong rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-app-text-primary rounded-full transition-all duration-300"
                    style={{ width: `${library.scanProgress}%` }}
                  />
                </div>
                <div className="text-[11px] text-app-text-tertiary">{library.scanProgress}% complete</div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (library.tracks.length === 0 && !library.error && settings.watchFolders.length === 0) {
      return <EmptyLibrary />;
    }

    if (library.error) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-[14px] text-red-400 mb-2">Something went wrong</div>
            <div className="text-[13px] text-app-text-tertiary mb-4">{library.error}</div>
            <button
              onClick={() => usePlayerStore.getState().loadLibrary()}
              className="px-4 py-2 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (library.tracks.length === 0 && settings.watchFolders.length > 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[14px] text-app-text-primary mb-2">No tracks found</div>
            <div className="text-[13px] text-app-text-tertiary mb-4">Try adding more folders</div>
            <button
              onClick={() => handleNavigate("folders")}
              className="px-4 py-2 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary"
            >
              Manage Folders
            </button>
          </div>
        </div>
      );
    }

    switch (navState.view) {
      case "now_playing":
        if (currentTrack) {
          return (
            <NowPlayingView
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              currentTime={currentTime}
              volume={volume}
              shuffle={shuffle}
              repeat={repeat}
              onClose={() => handleNavigate("library")}
              onPlayPause={onPlayPause}
              onNext={onNext}
              onPrev={onPrev}
              onScrubberChange={onScrubberChange}
              onVolumeChange={onVolumeChange}
              onToggleShuffle={onToggleShuffle}
              onCycleRepeat={onCycleRepeat}
            />
          );
        }
        return renderTrackView("All Songs", "Library", library.tracks, <Library size={40} className="text-app-text-tertiary" />);

      case "search":
        return (
          <SearchView
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlayTrack={(track, queue) => onPlayTrack(track, queue)}
            onNavigate={handleNavigate}
          />
        );

      case "favorites": {
        const favTracks = getFavoriteTracks();
        return renderTrackView(
          "Favorites",
          "Your Collection",
          favTracks,
          <Heart size={40} className="text-app-accent fill-current" />
        );
      }

      case "library":
        return renderTrackView(
          "All Songs",
          "Library",
          library.tracks,
          <Library size={40} className="text-app-text-tertiary" />
        );

      case "artists":
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title="Artists"
              subtitle="Library"
              meta={`${artists.length} artists`}
              icon={<Mic2 size={40} className="text-app-text-tertiary" />}
            />
            <GridView
              items={artists}
              onItemClick={(item) => handleNavigate("artist_detail", item.name)}
              onPlayItem={(item) => {
                const tracks = library.tracks.filter((t) => t.artist === item.name);
                if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
              }}
            />
          </div>
        );

      case "artist_detail": {
        const artistTracks = library.tracks.filter((t) => t.artist === navState.id);
        const artistPic = artistTracks.find((t) => t.picture)?.picture;
        return renderTrackView(
          navState.id ?? "Artist",
          "Artist",
          artistTracks,
          artistPic ? (
            <img src={artistPic} alt="" className="w-full h-full object-cover" />
          ) : (
            <Mic2 size={40} className="text-app-text-tertiary" />
          ),
          undefined,
          undefined,
          () => handleNavigate("artists")
        );
      }

      case "albums":
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title="Albums"
              subtitle="Library"
              meta={`${albums.length} albums`}
              icon={<Disc3 size={40} className="text-app-text-tertiary" />}
            />
            <GridView
              items={albums}
              onItemClick={(item) => handleNavigate("album_detail", item.name)}
              onPlayItem={(item) => {
                const tracks = library.tracks.filter((t) => t.album === item.name);
                if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
              }}
            />
          </div>
        );

      case "album_detail": {
        const albumTracks = library.tracks.filter((t) => t.album === navState.id);
        const albumPic = albumTracks.find((t) => t.picture)?.picture;
        return renderTrackView(
          navState.id ?? "Album",
          albumTracks[0]?.artist ?? "Album",
          albumTracks,
          albumPic ? (
            <img src={albumPic} alt="" className="w-full h-full object-cover" />
          ) : (
            <Disc3 size={40} className="text-app-text-tertiary" />
          ),
          undefined,
          undefined,
          () => handleNavigate("albums")
        );
      }

      case "playlists":
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title="Playlists"
              subtitle="Your Collection"
              meta={`${playlists.items.length} playlists`}
              icon={<ListMusic size={40} className="text-app-text-tertiary" />}
            />
            <GridView
              items={playlists.items.map((p) => ({
                id: p.id,
                name: p.name,
                desc: `${p.trackIds.length} songs`,
              }))}
              onItemClick={(item) => handleNavigate("playlist_detail", item.id)}
            />
          </div>
        );

      case "playlist_detail": {
        const plTracks = loadPlaylistTracks(navState.id ?? "");
        const activePlaylist = playlists.items.find((p) => p.id === navState.id);
        return renderTrackView(
          activePlaylist?.name ?? "Playlist",
          "Playlist",
          plTracks,
          <ListMusic size={40} className="text-app-text-tertiary" />,
          activePlaylist && (
            <PlaylistHeaderActions playlist={activePlaylist} onNavigate={handleNavigate} />
          ),
          activePlaylist?.id,
          () => handleNavigate("playlists")
        );
      }

      case "folders":
        return <FoldersView />;

      case "queue":
        return (
          <QueueView
            queue={playQueue}
            currentTrack={currentTrack}
            onPlayTrack={(track, queue) => onPlayTrack(track, queue)}
          />
        );

      case "recent": {
        const recent = recentlyPlayed.length > 0 ? recentlyPlayed : library.tracks.slice(0, 20);
        return renderTrackView(
          "Recently Played",
          "History",
          recent,
          <Music size={40} className="text-app-text-tertiary" />
        );
      }

      default: {
        const defaultTracks = playQueue.length > 0 ? playQueue : library.tracks.slice(0, 10);
        return renderTrackView(
          "Now Playing",
          "Queue",
          defaultTracks,
          <Music size={40} className="text-app-text-tertiary" />
        );
      }
    }
  };

  return (
    <div className="h-screen w-full bg-app-bg text-app-text-primary font-sans flex flex-col overflow-hidden">
      <TitleBar electrobun={electrobun} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar navState={navState} playlists={playlists.items} onNavigate={handleNavigate} />
        <main key={`${navState.view}-${navState.id ?? ""}`} className="flex-1 flex flex-col overflow-hidden animate-fade-in">
          {renderMainContent()}
        </main>
      </div>

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        volume={volume}
        shuffle={shuffle}
        repeat={repeat}
        onPlayPause={onPlayPause}
        onNext={onNext}
        onPrev={onPrev}
        onScrubberChange={onScrubberChange}
        onVolumeChange={onVolumeChange}
        onToggleMini={onToggleMini}
        onToggleShuffle={onToggleShuffle}
        onCycleRepeat={onCycleRepeat}
        onNavigateToQueue={() => handleNavigate("queue")}
        onNavigateToNowPlaying={() => handleNavigate("now_playing")}
      />
    </div>
  );
}
