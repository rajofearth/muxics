import { useState, useCallback, useEffect, useRef } from "react";
import { MainWindow } from "./MainWindow";
import { MiniPlayer } from "./MiniPlayer";
import { usePlayerStore } from "./store/playerStore";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useThemeFromArt } from "./hooks/useThemeFromArt";
import { AudioEngineProvider } from "./context/AudioEngineContext";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastContainer } from "./components/Toast";

const MINI_WIDTH = 380;
const MINI_HEIGHT = 776;

type AppElectrobun = {
  rpc?: {
    send?: {
      resizeWindow: (p: { width: number; height: number }) => void;
      setMinSize: (p: { width: number; height: number }) => void;
      closeWindow: () => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      showContextMenu: () => void;
      updateNowPlaying: (p: { title: string; artist: string; isPlaying: boolean }) => void;
      clearNowPlaying: () => void;
    };
    request?: unknown;
  };
};

type AppProps = {
  electrobun: AppElectrobun;
};

const MAIN_WINDOW_WIDTH = 1200;
const MAIN_WINDOW_HEIGHT = 800;

export default function App({ electrobun }: AppProps) {
  const [windowMode, setWindowMode] = useState<"main" | "mini">("main");
  const initRef = useRef(false);

  const { setRpc, loadLibrary, loadPlaylists, player } = usePlayerStore();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const handleNext = usePlayerStore((s) => s.handleNext);
  const handlePrev = usePlayerStore((s) => s.handlePrev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  const { analyserRef, analyserReady, seek } = useAudioEngine();
  useThemeFromArt();

  const rpcReady = usePlayerStore((s) => s.rpc !== null);

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (rpc && rpc.request) {
      setRpc(rpc as Parameters<typeof setRpc>[0]);
    }
    return () => setRpc(null);
  }, [electrobun, setRpc]);

  useEffect(() => {
    if (!initRef.current && rpcReady) {
      initRef.current = true;
      loadLibrary();
      loadPlaylists();
    }
  }, [rpcReady, loadLibrary, loadPlaylists]);

  useEffect(() => {
    const send = electrobun.rpc?.send;
    if (!send) return;

    if (player.currentTrack) {
      send.updateNowPlaying({
        title: player.currentTrack.title,
        artist: player.currentTrack.artist,
        isPlaying: player.isPlaying,
      });
    } else {
      send.clearNowPlaying();
    }
  }, [player.currentTrack?.id, player.isPlaying, electrobun.rpc?.send]);

  const switchToMiniRef = useRef<(() => void) | null>(null);
  const switchToMainRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handleAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      switch (action) {
        case "playPause": togglePlay(); break;
        case "prev": handlePrev(); break;
        case "next": handleNext(); break;
        case "close": electrobun.rpc?.send?.closeWindow?.(); break;
        case "miniPlayer": switchToMiniRef.current?.(); break;
        case "viewLibrary":
          document.dispatchEvent(new CustomEvent("app-navigate", { detail: "library" }));
          break;
        case "viewNowPlaying":
          document.dispatchEvent(new CustomEvent("app-navigate", { detail: "now_playing" }));
          break;
        case "viewSearch":
          document.dispatchEvent(new CustomEvent("app-navigate", { detail: "search" }));
          break;
        case "viewMini":
          switchToMiniRef.current?.();
          break;
        case "volumeUp":
          setVolume(Math.min(1, usePlayerStore.getState().player.volume + 0.05));
          break;
        case "volumeDown":
          setVolume(Math.max(0, usePlayerStore.getState().player.volume - 0.05));
          break;
      }
    };

    document.addEventListener("winamp-context-action", handleAction);
    document.addEventListener("winamp-menu-action", handleAction);
    return () => {
      document.removeEventListener("winamp-context-action", handleAction);
      document.removeEventListener("winamp-menu-action", handleAction);
    };
  }, [togglePlay, handlePrev, handleNext, electrobun, setVolume]);

  const switchToMini = useCallback(() => {
    electrobun.rpc?.send?.setMinSize?.({ width: MINI_WIDTH, height: 600 });
    electrobun.rpc?.send?.resizeWindow?.({ width: MINI_WIDTH, height: MINI_HEIGHT });
    setWindowMode("mini");
  }, [electrobun]);

  const switchToMain = useCallback(() => {
    electrobun.rpc?.send?.setMinSize?.({ width: 800, height: 600 });
    electrobun.rpc?.send?.resizeWindow?.({ width: MAIN_WINDOW_WIDTH, height: MAIN_WINDOW_HEIGHT });
    setWindowMode("main");
  }, [electrobun]);

  switchToMiniRef.current = switchToMini;
  switchToMainRef.current = switchToMain;

  return (
    <ThemeProvider>
      {windowMode === "mini" ? (
        <div className="h-full w-full">
          <MiniPlayer
            electrobun={electrobun}
            onExpandToMain={switchToMain}
            currentTrack={player.currentTrack}
            isPlaying={player.isPlaying}
            playQueue={player.queue}
            currentTime={player.currentTime}
            volume={player.volume}
            onPlayPause={togglePlay}
            onNext={handleNext}
            onPrev={handlePrev}
            onScrubberChange={seek}
            onVolumeChange={setVolume}
            onTrackSelect={(track, queue) => playTrack(track, queue)}
          />
        </div>
      ) : (
        <AudioEngineProvider analyserRef={analyserRef} analyserReady={analyserReady}>
          <MainWindow
            electrobun={electrobun}
            onToggleMini={switchToMini}
            currentTrack={player.currentTrack}
            isPlaying={player.isPlaying}
            playQueue={player.queue}
            currentTime={player.currentTime}
            volume={player.volume}
            shuffle={player.shuffle}
            repeat={player.repeat}
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
