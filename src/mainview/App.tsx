import { useState, useCallback, useEffect, useRef } from "react";
import { MainWindow } from "./MainWindow";
import { MiniPlayer } from "./MiniPlayer";
import { usePlayerStore } from "./store/playerStore";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useThemeFromArt } from "./hooks/useThemeFromArt";
import { AudioEngineProvider } from "./context/AudioEngineContext";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastContainer } from "./components/Toast";
import { SplashScreen } from "./components/SplashScreen";
import { INIT_STATUS_SESSION_REJECTED } from "./store/playerStore";
import type { DesktopBridge } from "../shared/desktop-contract";

const MINI_WIDTH = 380;
const MINI_HEIGHT = 776;

type AppProps = {
  desktop: DesktopBridge;
};

const MAIN_WINDOW_WIDTH = 1200;
const MAIN_WINDOW_HEIGHT = 800;

export default function App({ desktop }: AppProps) {
  const [windowMode, setWindowMode] = useState<"main" | "mini">("main");
  const initRef = useRef(false);

  const setRpc = usePlayerStore((s) => s.setRpc);
  const loadLibrary = usePlayerStore((s) => s.loadLibrary);
  const loadPlaylists = usePlayerStore((s) => s.loadPlaylists);
  const loadAuthStatus = usePlayerStore((s) => s.loadAuthStatus);
  const hydrateYtMusicFromCache = usePlayerStore(
    (s) => s.hydrateYtMusicFromCache,
  );
  const syncYtMusicLibrary = usePlayerStore((s) => s.syncYtMusicLibrary);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const handleNext = usePlayerStore((s) => s.handleNext);
  const handlePrev = usePlayerStore((s) => s.handlePrev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const currentTrack = usePlayerStore((s) => s.player.currentTrack);
  const isPlaying = usePlayerStore((s) => s.player.isPlaying);
  const playQueue = usePlayerStore((s) => s.player.queue);
  const volume = usePlayerStore((s) => s.player.volume);
  const shuffle = usePlayerStore((s) => s.player.shuffle);
  const repeat = usePlayerStore((s) => s.player.repeat);

  const { analyserRef, analyserReady, seek } = useAudioEngine();
  useThemeFromArt();

  const rpcReady = usePlayerStore((s) => s.rpc !== null);

  useEffect(() => {
    setRpc(desktop);
    return () => setRpc(null);
  }, [desktop, setRpc]);

  const setInitReady = usePlayerStore((s) => s.setInitReady);
  const setInitStatus = usePlayerStore((s) => s.setInitStatus);
  const initReady = usePlayerStore((s) => s._initReady);

  useEffect(() => {
    if (!initRef.current && rpcReady) {
      initRef.current = true;
      void (async () => {
        setInitStatus("Checking authentication...");
        await loadAuthStatus();
        const loggedIn = usePlayerStore.getState().auth.loggedIn;

        setInitStatus("Scanning local library...");
        const libraryPromise = loadLibrary();

        setInitStatus("Loading playlists...");
        const playlistsPromise = loadPlaylists();

        let cachePromise = Promise.resolve();
        if (loggedIn) {
          setInitStatus("Loading YouTube Music...");
          cachePromise = hydrateYtMusicFromCache();
        }

        await Promise.all([libraryPromise, playlistsPromise, cachePromise]);

        if (loggedIn) {
          setInitStatus("Syncing YouTube Music...");
          await syncYtMusicLibrary();

          // If sync failed because the YouTube Music session was rejected,
          // stay on the splash screen so the user sees the logged-out message
          // with clear reconnect instructions.
          if (usePlayerStore.getState().auth.sessionExpired) {
            setInitStatus(INIT_STATUS_SESSION_REJECTED);
            return;
          }
        }

        setInitStatus("Almost ready...");
        // Small tick so the final status renders before transitioning
        await new Promise((r) => setTimeout(r, 200));

        setInitReady();
      })();
    }
  }, [
    rpcReady,
    loadAuthStatus,
    loadLibrary,
    loadPlaylists,
    hydrateYtMusicFromCache,
    syncYtMusicLibrary,
    setInitReady,
    setInitStatus,
  ]);

  useEffect(() => {
    if (currentTrack) {
      desktop.send.updateNowPlaying({
        title: currentTrack.title,
        artist: currentTrack.artist,
        isPlaying,
      });
    } else {
      desktop.send.clearNowPlaying();
    }
  }, [
    desktop,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    isPlaying,
  ]);

  const switchToMiniRef = useRef<(() => void) | null>(null);
  const switchToMainRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handleAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      switch (action) {
        case "playPause":
          togglePlay();
          break;
        case "prev":
          handlePrev();
          break;
        case "next":
          handleNext();
          break;
        case "close":
          desktop.send.closeWindow();
          break;
        case "miniPlayer":
          switchToMiniRef.current?.();
          break;
        case "viewLibrary":
          document.dispatchEvent(
            new CustomEvent("app-navigate", { detail: "library" }),
          );
          break;
        case "viewNowPlaying":
          document.dispatchEvent(
            new CustomEvent("app-navigate", { detail: "now_playing" }),
          );
          break;
        case "viewSearch":
          document.dispatchEvent(
            new CustomEvent("app-navigate", { detail: "search" }),
          );
          break;
        case "viewMini":
          switchToMiniRef.current?.();
          break;
        case "volumeUp":
          setVolume(
            Math.min(1, usePlayerStore.getState().player.volume + 0.05),
          );
          break;
        case "volumeDown":
          setVolume(
            Math.max(0, usePlayerStore.getState().player.volume - 0.05),
          );
          break;
      }
    };

    document.addEventListener("winamp-context-action", handleAction);
    document.addEventListener("winamp-menu-action", handleAction);
    return () => {
      document.removeEventListener("winamp-context-action", handleAction);
      document.removeEventListener("winamp-menu-action", handleAction);
    };
  }, [desktop, togglePlay, handlePrev, handleNext, setVolume]);

  const switchToMini = useCallback(() => {
    desktop.send.setMinSize({ width: MINI_WIDTH, height: 600 });
    desktop.send.resizeWindow({ width: MINI_WIDTH, height: MINI_HEIGHT });
    setWindowMode("mini");
  }, [desktop]);

  const switchToMain = useCallback(() => {
    desktop.send.setMinSize({ width: 800, height: 600 });
    desktop.send.resizeWindow({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
    });
    setWindowMode("main");
  }, [desktop]);

  switchToMiniRef.current = switchToMini;
  switchToMainRef.current = switchToMain;

  return (
    <ThemeProvider>
      {!initReady ? (
        <div className="h-screen w-full bg-app-bg flex flex-col">
          <SplashScreen />
        </div>
      ) : windowMode === "mini" ? (
        <div className="h-full w-full">
          <MiniPlayer
            desktop={desktop}
            onExpandToMain={switchToMain}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playQueue={playQueue}
            volume={volume}
            onPlayPause={togglePlay}
            onNext={handleNext}
            onPrev={handlePrev}
            onScrubberChange={seek}
            onVolumeChange={setVolume}
            onTrackSelect={(track, queue) => playTrack(track, queue)}
          />
        </div>
      ) : (
        <AudioEngineProvider
          analyserRef={analyserRef}
          analyserReady={analyserReady}
        >
          <MainWindow
            desktop={desktop}
            onToggleMini={switchToMini}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playQueue={playQueue}
            volume={volume}
            shuffle={shuffle}
            repeat={repeat}
            onPlayTrack={(track, queue) => playTrack(track, queue)}
            onPlayPause={togglePlay}
            onNext={handleNext}
            onPrev={handlePrev}
            onScrubberChange={seek}
            onVolumeChange={setVolume}
            onToggleShuffle={toggleShuffle}
            onCycleRepeat={cycleRepeat}
          />
        </AudioEngineProvider>
      )}
      <ToastContainer />
    </ThemeProvider>
  );
}
