import { useEffect } from "react";
import type { ReactNode } from "react";
import type { Track, NavState, NavView, LibrarySource } from "../types";
import type { PlayerState } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { formatTotalDuration, playlistVisibleTrackCount } from "../utils";
import {
  Library,
  Mic2,
  Disc3,
  ListMusic,
  Music,
  Play,
  Heart,
  Shuffle,
  LogIn,
  RefreshCw,
} from "lucide-react";
import { HeroHeader } from "./HeroHeader";
import { TabNav } from "./TabNav";
import { TrackTable } from "./TrackTable";
import { GridView } from "./GridView";
import { EmptyLibrary } from "./EmptyLibrary";
import { PlaylistHeaderActions } from "./PlaylistHeaderActions";
import { SearchView } from "./SearchView";
import { QueueView } from "./QueueView";
import { NowPlayingView } from "./NowPlayingView";
import { SettingsView } from "./SettingsView";
import { Collage } from "./Collage";
import type { DesktopBridge } from "../../shared/desktop-contract";

export type MainWindowContentProps = {
  desktop?: DesktopBridge;
  navState: NavState;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  handleNavigate: (view: NavView, id?: string) => void;
  handleOpenLogin: () => void;
  setLibrarySource: (source: LibrarySource) => void;
  library: PlayerState["library"];
  playlists: PlayerState["playlists"];
  settings: PlayerState["settings"];
  auth: PlayerState["auth"];
  authLogin: PlayerState["authLogin"];
  recentlyPlayed: PlayerState["recentlyPlayed"];
  getFavoriteTracks: () => Track[];
  loadPlaylistTracks: (playlistId: string) => Track[];
  libraryScopeLabel: string;
  artists: { id: string; name: string; desc: string; picture?: string }[];
  albums: { id: string; name: string; desc: string; picture?: string }[];
  currentTrack: Track | null;
  isPlaying: boolean;
  playQueue: Track[];
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
  handlePlayAll: (tracks: Track[]) => void;
  handleShufflePlay: (tracks: Track[]) => void;
};

export function MainWindowContent({
  desktop,
  navState,
  activeTab,
  setActiveTab,
  handleNavigate,
  handleOpenLogin,
  setLibrarySource,
  library,
  playlists,
  settings,
  auth,
  authLogin,
  recentlyPlayed,
  getFavoriteTracks,
  loadPlaylistTracks,
  libraryScopeLabel,
  artists,
  albums,
  currentTrack,
  isPlaying,
  playQueue,
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
  handlePlayAll,
  handleShufflePlay,
}: MainWindowContentProps) {
  useEffect(() => {
    const handleCacheUpdate = () => {
      void usePlayerStore.getState().loadCachedPlaylist();
    };
    document.addEventListener("muxics-yt-cache-stats", handleCacheUpdate);
    return () =>
      document.removeEventListener("muxics-yt-cache-stats", handleCacheUpdate);
  }, []);

  const renderTrackView = (
    title: string,
    subtitle: string,
    tracks: Track[],
    icon: ReactNode,
    extraActions?: ReactNode,
    playlistId?: string,
    onBack?: () => void,
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
                  type="button"
                  onClick={() => handlePlayAll(tracks)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-app-text-primary text-app-bg rounded-full text-[12px] font-medium hover:opacity-90"
                >
                  <Play size={12} className="fill-current" /> Play
                </button>
                <button
                  type="button"
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
      <div className="px-8 pt-3 pb-2 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap" />
        <div className="flex items-center gap-2 text-[11px] text-app-text-tertiary">
          {library.syncingRemote ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              Syncing
            </>
          ) : auth.lastSyncedAt ? (
            <span>Synced</span>
          ) : null}
        </div>
      </div>
      <TabNav
        tabs={[
          "All",
          ...Array.from(new Set(tracks.map((t) => t.genre).filter(Boolean))),
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <TrackTable
        tracks={
          activeTab === "All"
            ? tracks
            : tracks.filter((t) => t.genre === activeTab)
        }
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onTrackClick={(track, queue) => onPlayTrack(track, queue)}
        onActiveTrackClick={onPlayPause}
        playlistId={playlistId}
      />
    </div>
  );

  if (library.source === "ytmusic" && !auth.loggedIn) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md text-center px-8">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-app-elevated flex items-center justify-center">
            <Music size={26} className="text-app-text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-app-text-primary mb-2">
            Sign in to YouTube Music
          </h2>
          <p className="text-[13px] text-app-text-tertiary mb-5">
            Connect your account to sync playlists, search your library, and
            stream directly inside the app.
          </p>
          {authLogin.error ? (
            <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
              {authLogin.error}
            </div>
          ) : null}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleOpenLogin}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-app-text-primary text-app-bg text-[13px] font-medium hover:opacity-90"
            >
              <LogIn size={14} />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setLibrarySource("local")}
              className="px-4 py-2 rounded-xl bg-app-elevated text-app-text-primary text-[13px] hover:bg-app-active"
            >
              Use Local Files
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (library.loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center w-64">
          <div className="w-10 h-10 border-2 border-app-text-tertiary border-t-app-text-primary rounded-full animate-spin mx-auto mb-4" />
          <div className="text-[14px] text-app-text-primary mb-3">
            Scanning library...
          </div>
          {library.scanProgress > 0 && (
            <div>
              <div className="h-1 bg-app-border-strong rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-app-text-primary rounded-full transition-all duration-300"
                  style={{ width: `${library.scanProgress}%` }}
                />
              </div>
              <div className="text-[11px] text-app-text-tertiary">
                {library.scanProgress}% complete
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (
    library.source !== "ytmusic" &&
    library.tracks.length === 0 &&
    !library.error &&
    settings.watchFolders.length === 0
  ) {
    return <EmptyLibrary />;
  }

  if (library.error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-[14px] text-red-400 mb-2">
            Something went wrong
          </div>
          <div className="text-[13px] text-app-text-tertiary mb-4">
            {library.error}
          </div>
          <button
            type="button"
            onClick={() => {
              const store = usePlayerStore.getState();
              if (library.source === "ytmusic") {
                void store.syncYtMusicLibrary();
              } else {
                void store.loadLibrary();
              }
            }}
            className="px-4 py-2 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (
    library.source !== "ytmusic" &&
    library.tracks.length === 0 &&
    settings.watchFolders.length > 0
  ) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-[14px] text-app-text-primary mb-2">
            No tracks found
          </div>
          <div className="text-[13px] text-app-text-tertiary mb-4">
            Try adding more folders
          </div>
          <button
            type="button"
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
      return renderTrackView(
        "All Songs",
        libraryScopeLabel,
        library.tracks,
        <Library size={40} className="text-app-text-tertiary" />,
      );

    case "search":
      return (
        <SearchView
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onPlayTrack={(track, queue) => onPlayTrack(track, queue)}
          onPlayPause={onPlayPause}
          onNavigate={handleNavigate}
        />
      );

    case "favorites": {
      const favTracks = getFavoriteTracks();
      return renderTrackView(
        "Favorites",
        "Your Collection",
        favTracks,
        <Heart size={40} className="text-app-accent fill-current" />,
      );
    }

    case "library":
      return renderTrackView(
        "All Songs",
        libraryScopeLabel,
        library.tracks,
        <Library size={40} className="text-app-text-tertiary" />,
      );

    case "artists":
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <HeroHeader
            title="Artists"
            subtitle={libraryScopeLabel}
            meta={`${artists.length} artists`}
            icon={<Mic2 size={40} className="text-app-text-tertiary" />}
          />
          <GridView
            items={artists}
            onItemClick={(item) => handleNavigate("artist_detail", item.name)}
            onPlayItem={(item) => {
              const tracks = library.tracks.filter(
                (t) => t.artist === item.name,
              );
              if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
            }}
          />
        </div>
      );

    case "artist_detail": {
      const artistTracks = library.tracks.filter(
        (t) => t.artist === navState.id,
      );
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
        () => handleNavigate("artists"),
      );
    }

    case "albums":
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <HeroHeader
            title="Albums"
            subtitle={libraryScopeLabel}
            meta={`${albums.length} albums`}
            icon={<Disc3 size={40} className="text-app-text-tertiary" />}
          />
          <GridView
            items={albums}
            onItemClick={(item) => handleNavigate("album_detail", item.name)}
            onPlayItem={(item) => {
              const tracks = library.tracks.filter(
                (t) => t.album === item.name,
              );
              if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
            }}
          />
        </div>
      );

    case "album_detail": {
      const isYt = navState.id?.startsWith("ytmusic:");
      const activeAlbum = isYt
        ? playlists.items.find((p) => p.id === navState.id)
        : null;
      const albumTracks = isYt
        ? activeAlbum
          ? loadPlaylistTracks(activeAlbum.id)
          : []
        : library.tracks.filter((t) => t.album === navState.id);

      const albumLoading = activeAlbum
        ? playlists.hydratingById[activeAlbum.id]
        : false;
      const albumError = activeAlbum
        ? playlists.hydrationErrors[activeAlbum.id]
        : null;
      const albumPic = isYt
        ? activeAlbum?.picture
        : albumTracks.find((t) => t.picture)?.picture;

      if (
        isYt &&
        albumLoading &&
        !(activeAlbum?.tracks && activeAlbum.tracks.length > 0)
      ) {
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title={activeAlbum?.name ?? "Album"}
              subtitle="YouTube Music"
              meta="Loading album tracks..."
              icon={<Disc3 size={40} className="text-app-text-tertiary" />}
              onBack={() => handleNavigate("albums")}
            />
            <div className="flex-1 flex items-center justify-center px-8">
              <div className="w-full max-w-xl rounded-3xl border border-app-border bg-app-surface-alt/70 px-6 py-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-app-text-tertiary border-t-app-text-primary animate-spin" />
                <div className="text-[15px] font-medium text-app-text-primary">
                  Loading album details...
                </div>
              </div>
            </div>
          </div>
        );
      }

      if (
        isYt &&
        activeAlbum &&
        albumError &&
        !(activeAlbum.tracks && activeAlbum.tracks.length > 0)
      ) {
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title={activeAlbum?.name ?? "Album"}
              subtitle="YouTube Music"
              meta="Album unavailable"
              icon={<Disc3 size={40} className="text-app-text-tertiary" />}
              onBack={() => handleNavigate("albums")}
              actions={
                <PlaylistHeaderActions
                  playlist={activeAlbum!}
                  onNavigate={handleNavigate}
                />
              }
            />
            <div className="flex-1 px-8 pb-8">
              <div className="rounded-3xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-[13px] text-red-200">
                {albumError}
              </div>
            </div>
          </div>
        );
      }

      return renderTrackView(
        isYt ? (activeAlbum?.name ?? "Album") : (navState.id ?? "Album"),
        isYt
          ? (activeAlbum?.author ?? "YouTube Music")
          : (albumTracks[0]?.artist ?? "Album"),
        albumTracks,
        albumPic ? (
          <img src={albumPic} alt="" className="w-full h-full object-cover" />
        ) : (
          <Disc3 size={40} className="text-app-text-tertiary" />
        ),
        isYt && activeAlbum ? (
          <PlaylistHeaderActions
            playlist={activeAlbum}
            onNavigate={handleNavigate}
          />
        ) : undefined,
        isYt ? activeAlbum?.id : undefined,
        () => handleNavigate("albums"),
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
            items={playlists.items.map((p) => {
              const tracks = loadPlaylistTracks(p.id);
              const recentPics: string[] = [];
              for (let i = tracks.length - 1; i >= 0; i--) {
                const pic = tracks[i]?.picture;
                if (pic && !recentPics.includes(pic)) {
                  recentPics.push(pic);
                }
                if (recentPics.length === 4) break;
              }
              return {
                id: p.id,
                name: p.name,
                desc: `${playlistVisibleTrackCount(p)} songs`,
                pictures: recentPics,
              };
            })}
            onItemClick={(item) => handleNavigate("playlist_detail", item.id)}
          />
        </div>
      );

    case "playlist_detail": {
      const plTracks = loadPlaylistTracks(navState.id ?? "");
      const activePlaylist = playlists.items.find((p) => p.id === navState.id);
      const playlistLoading = activePlaylist
        ? playlists.hydratingById[activePlaylist.id]
        : false;
      const playlistError = activePlaylist
        ? playlists.hydrationErrors[activePlaylist.id]
        : null;

      const recentPics: string[] = [];
      for (let i = plTracks.length - 1; i >= 0; i--) {
        const pic = plTracks[i]?.picture;
        if (pic && !recentPics.includes(pic)) {
          recentPics.push(pic);
        }
        if (recentPics.length === 4) break;
      }

      if (
        activePlaylist?.provider === "ytmusic" &&
        playlistLoading &&
        !(activePlaylist.tracks && activePlaylist.tracks.length > 0)
      ) {
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title={activePlaylist.name}
              subtitle="YouTube Music"
              meta="Loading playlist tracks..."
              icon={<ListMusic size={40} className="text-app-text-tertiary" />}
              onBack={() => handleNavigate("playlists")}
            />
            <div className="flex-1 flex items-center justify-center px-8">
              <div className="w-full max-w-xl rounded-3xl border border-app-border bg-app-surface-alt/70 px-6 py-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-app-text-tertiary border-t-app-text-primary animate-spin" />
                <div className="text-[15px] font-medium text-app-text-primary">
                  Loading this YouTube Music playlist...
                </div>
              </div>
            </div>
          </div>
        );
      }

      if (
        activePlaylist?.provider === "ytmusic" &&
        playlistError &&
        !(activePlaylist.tracks && activePlaylist.tracks.length > 0)
      ) {
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <HeroHeader
              title={activePlaylist.name}
              subtitle="YouTube Music"
              meta="Playlist unavailable"
              icon={<ListMusic size={40} className="text-app-text-tertiary" />}
              onBack={() => handleNavigate("playlists")}
              actions={
                <PlaylistHeaderActions
                  playlist={activePlaylist}
                  onNavigate={handleNavigate}
                />
              }
            />
            <div className="flex-1 px-8 pb-8">
              <div className="rounded-3xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-[13px] text-red-200">
                {playlistError}
              </div>
            </div>
          </div>
        );
      }

      return renderTrackView(
        activePlaylist?.name ?? "Playlist",
        activePlaylist?.provider === "ytmusic" ? "YouTube Music" : "Playlist",
        plTracks,
        <Collage
          pictures={recentPics}
          fallback={activePlaylist?.picture}
          FallbackIcon={ListMusic}
          iconSize={40}
        />,
        activePlaylist ? (
          <PlaylistHeaderActions
            playlist={activePlaylist}
            onNavigate={handleNavigate}
          />
        ) : undefined,
        activePlaylist?.id,
        () => handleNavigate("playlists"),
      );
    }

    case "queue":
      return (
        <QueueView
          queue={playQueue}
          currentTrack={currentTrack}
          onPlayTrack={(track, queue) => onPlayTrack(track, queue)}
        />
      );

    case "recent": {
      const recent =
        recentlyPlayed.length > 0
          ? recentlyPlayed
          : library.tracks.slice(0, 20);
      const recentPics = Array.from(
        new Set(recent.map((t) => t.picture).filter((p): p is string => !!p)),
      ).slice(0, 4);
      return renderTrackView(
        "Recently Played",
        "History",
        recent,
        <Collage pictures={recentPics} FallbackIcon={Music} iconSize={40} />,
      );
    }

    case "settings":
      return <SettingsView desktop={desktop} />;

    default: {
      const defaultTracks =
        playQueue.length > 0 ? playQueue : library.tracks.slice(0, 10);
      return renderTrackView(
        "Now Playing",
        "Queue",
        defaultTracks,
        <Music size={40} className="text-app-text-tertiary" />,
      );
    }
  }
}
