import { useState, useMemo, useCallback, useEffect, startTransition } from "react";
import { useShallow } from "zustand/react/shallow";
import type { NavState, NavView, Track } from "./types";
import { usePlayerStore } from "./store/playerStore";
import { shuffleArray } from "./utils";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { BrowserBridgeDialog } from "./components/BrowserBridgeDialog";
import { showToast } from "./components/Toast";
import { MainWindowContent } from "./components/MainWindowContent";
import type { DesktopBridge } from "../shared/desktop-contract";

type MainWindowProps = {
  desktop?: DesktopBridge;
  onToggleMini?: () => void;
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
};

export function MainWindow({
  desktop,
  onToggleMini,
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
}: MainWindowProps) {
  const [navState, setNavState] = useState<NavState>({
    view: "library",
    id: undefined,
  });
  const [activeTab, setActiveTab] = useState<string>("All");
  const [showBridgeDialog, setShowBridgeDialog] = useState(false);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeFolderPath, setBridgeFolderPath] = useState<string | null>(null);
  const [bridgeZipPath, setBridgeZipPath] = useState<string | null>(null);
  const [bridgeExtensionId, setBridgeExtensionId] = useState<string | null>(null);
  const {
    library,
    playlists,
    ensurePlaylistHydrated,
    settings,
    recentlyPlayed,
    getFavoriteTracks,
    auth,
    authLogin,
    loadAuthStatus,
    setLibrarySource,
    clearAuthLoginError,
    logoutFromYtMusic,
    syncYtMusicLibrary,
    loadPlaylistTracks,
  } = usePlayerStore(
    useShallow((s) => ({
      library: s.library,
      playlists: s.playlists,
      ensurePlaylistHydrated: s.ensurePlaylistHydrated,
      settings: s.settings,
      recentlyPlayed: s.recentlyPlayed,
      getFavoriteTracks: s.getFavoriteTracks,
      auth: s.auth,
      authLogin: s.authLogin,
      loadAuthStatus: s.loadAuthStatus,
      setLibrarySource: s.setLibrarySource,
      clearAuthLoginError: s.clearAuthLoginError,
      logoutFromYtMusic: s.logoutFromYtMusic,
      syncYtMusicLibrary: s.syncYtMusicLibrary,
      loadPlaylistTracks: s.loadPlaylistTracks,
    })),
  );

  const libraryScopeLabel = library.source === "ytmusic" ? "YouTube Music" : "Library";

  const handleOpenLogin = useCallback(() => {
    clearAuthLoginError();
    setShowBridgeDialog(true);
  }, [clearAuthLoginError]);

  const handleSourceChange = useCallback((source: "all" | "local" | "ytmusic") => {
    startTransition(() => {
      setLibrarySource(source);
    });
  }, [setLibrarySource]);

  const handlePrepareBridge = useCallback(() => {
    void (async () => {
      setBridgeBusy(true);
      clearAuthLoginError();
      const result = await desktop?.request.prepareBrowserBridge();
      setBridgeBusy(false);

      if (!result?.success) {
        showToast(result?.error ?? "Could not prepare the browser bridge.", "error");
        return;
      }

      setBridgeExtensionId(result.extensionId);
      setBridgeFolderPath(result.folderPath ?? null);
      setBridgeZipPath(result.zipPath ?? null);
      showToast("Browser bridge files are ready.");
    })();
  }, [clearAuthLoginError, desktop]);

  const handleRefreshBridge = useCallback(() => {
    void (async () => {
      setBridgeBusy(true);
      await loadAuthStatus();
      setBridgeBusy(false);

      if (usePlayerStore.getState().auth.loggedIn) {
        showToast("YouTube Music is connected.");
        setShowBridgeDialog(false);
        await syncYtMusicLibrary();
      } else {
        showToast("No browser session received yet.", "info");
      }
    })();
  }, [loadAuthStatus, syncYtMusicLibrary]);

  const handleNavigate = useCallback((view: NavView, id?: string) => {
    setNavState({ view, id });
    setActiveTab("All");
  }, []);

  useEffect(() => {
    const navHandler = (e: Event) => {
      const view = (e as CustomEvent<string>).detail;
      if (view) handleNavigate(view as NavView);
    };
    document.addEventListener("app-navigate", navHandler);
    return () => document.removeEventListener("app-navigate", navHandler);
  }, [handleNavigate]);

  useEffect(() => {
    if (navState.view !== "playlist_detail" || !navState.id) {
      return;
    }

    const activePlaylist = playlists.items.find((playlist) => playlist.id === navState.id);
    if (!activePlaylist || activePlaylist.provider !== "ytmusic") {
      return;
    }

    void ensurePlaylistHydrated(activePlaylist.id);
  }, [ensurePlaylistHydrated, navState.id, navState.view, playlists.items]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          onPlayPause();
          break;
        case "ArrowRight":
          if (e.metaKey || e.ctrlKey) {
            onNext();
            e.preventDefault();
          }
          break;
        case "ArrowLeft":
          if (e.metaKey || e.ctrlKey) {
            onPrev();
            e.preventDefault();
          }
          break;
        case "ArrowUp":
          if (e.metaKey || e.ctrlKey) {
            onVolumeChange(Math.min(1, volume + 0.05));
            e.preventDefault();
          }
          break;
        case "ArrowDown":
          if (e.metaKey || e.ctrlKey) {
            onVolumeChange(Math.max(0, volume - 0.05));
            e.preventDefault();
          }
          break;
        case "f":
        case "F":
          if (e.metaKey || e.ctrlKey) {
            handleNavigate("search");
            e.preventDefault();
          }
          break;
        case "Escape":
          if (navState.view === "now_playing") {
            handleNavigate("library");
            e.preventDefault();
          } else if (navState.view === "artist_detail") {
            handleNavigate("artists");
            e.preventDefault();
          } else if (navState.view === "album_detail") {
            handleNavigate("albums");
            e.preventDefault();
          } else if (navState.view === "playlist_detail") {
            handleNavigate("playlists");
            e.preventDefault();
          } else if (navState.view === "search") {
            handleNavigate("library");
            e.preventDefault();
          }
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
  }, [
    currentTrack,
    handleNavigate,
    navState.view,
    onNext,
    onPlayPause,
    onPrev,
    onVolumeChange,
    volume,
  ]);

  const { artists, albums } = useMemo(() => {
    const byArtist = new Map<string, Track[]>();
    const byAlbum = new Map<string, Track[]>();
    for (const t of library.tracks) {
      const a = t.artist || "Unknown Artist";
      let listA = byArtist.get(a);
      if (!listA) {
        listA = [];
        byArtist.set(a, listA);
      }
      listA.push(t);
      const alb = t.album?.trim();
      if (alb) {
        let listAl = byAlbum.get(alb);
        if (!listAl) {
          listAl = [];
          byAlbum.set(alb, listAl);
        }
        listAl.push(t);
      }
    }
    const artists = [...byArtist.entries()].map(([name, tracks]) => ({
      id: name,
      name,
      desc: `${tracks.length} songs`,
      picture: tracks.find((t) => t.picture)?.picture,
    }));
    const albums = [...byAlbum.entries()].map(([name, tracks]) => ({
      id: name,
      name,
      desc: tracks[0]?.artist ?? "",
      picture: tracks.find((t) => t.picture)?.picture,
    }));
    return { artists, albums };
  }, [library.tracks]);

  const handlePlayAll = useCallback(
    (tracks: Track[]) => {
      if (tracks.length > 0) onPlayTrack(tracks[0], tracks);
    },
    [onPlayTrack],
  );

  const handleShufflePlay = useCallback(
    (tracks: Track[]) => {
      if (tracks.length > 0) {
        const shuffled = shuffleArray(tracks);
        onPlayTrack(shuffled[0], shuffled);
      }
    },
    [onPlayTrack],
  );

  return (
    <div className="h-screen w-full bg-app-bg text-app-text-primary font-sans flex flex-col overflow-hidden">
      <TitleBar
        desktop={desktop}
        title={currentTrack ? currentTrack.title : "Muxics"}
        subtitle={currentTrack ? currentTrack.artist : "Library"}
        auth={auth}
        source={library.source}
        onSourceChange={handleSourceChange}
        onLogin={handleOpenLogin}
        onLogout={logoutFromYtMusic}
        onSync={syncYtMusicLibrary}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar navState={navState} playlists={playlists.items} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-hidden animate-fade-in">
          <MainWindowContent
            desktop={desktop}
            navState={navState}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            handleNavigate={handleNavigate}
            handleOpenLogin={handleOpenLogin}
            setLibrarySource={setLibrarySource}
            library={library}
            playlists={playlists}
            settings={settings}
            auth={auth}
            authLogin={authLogin}
            recentlyPlayed={recentlyPlayed}
            getFavoriteTracks={getFavoriteTracks}
            loadPlaylistTracks={loadPlaylistTracks}
            libraryScopeLabel={libraryScopeLabel}
            artists={artists}
            albums={albums}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playQueue={playQueue}
            volume={volume}
            shuffle={shuffle}
            repeat={repeat}
            onPlayTrack={onPlayTrack}
            onPlayPause={onPlayPause}
            onNext={onNext}
            onPrev={onPrev}
            onScrubberChange={onScrubberChange}
            onVolumeChange={onVolumeChange}
            onToggleShuffle={onToggleShuffle}
            onCycleRepeat={onCycleRepeat}
            handlePlayAll={handlePlayAll}
            handleShufflePlay={handleShufflePlay}
          />
        </main>
      </div>

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
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

      {showBridgeDialog ? (
        <BrowserBridgeDialog
          loading={bridgeBusy || authLogin.loading}
          error={authLogin.error}
          extensionId={bridgeExtensionId}
          folderPath={bridgeFolderPath}
          zipPath={bridgeZipPath}
          onClose={() => {
            clearAuthLoginError();
            setShowBridgeDialog(false);
          }}
          onPrepareBundle={handlePrepareBridge}
          onOpenPath={(path) => void desktop?.request.openPath({ path })}
          onRefresh={handleRefreshBridge}
        />
      ) : null}
    </div>
  );
}
