import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MainWindow } from "./MainWindow";
import { MiniPlayer } from "./MiniPlayer";
import { WinampContextMenu } from "./WinampContextMenu";
import { usePlayerStore } from "./store/playerStore";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useThemeFromArt } from "./hooks/useThemeFromArt";
import { AudioEngineProvider } from "./context/AudioEngineContext";
import { ThemeProvider } from "./components/ThemeProvider";

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
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
    const handler = (e: CustomEvent<{ x: number; y: number }>) => {
      setContextMenu({ x: e.detail.x, y: e.detail.y });
    };
    const wrapped = (e: Event) => handler(e as CustomEvent<{ x: number; y: number }>);
    document.addEventListener("winamp-show-context-menu", wrapped);
    return () => document.removeEventListener("winamp-show-context-menu", wrapped);
  }, []);

  const handleContextMenuAction = useCallback((action: string) => {
    document.dispatchEvent(new CustomEvent("winamp-context-action", { detail: action }));
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      switch (e.detail) {
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
          electrobun.rpc?.send?.closeWindow?.();
          break;
      }
    };
    const wrapped = (e: Event) => handler(e as CustomEvent<string>);
    document.addEventListener("winamp-context-action", wrapped);
    return () => document.removeEventListener("winamp-context-action", wrapped);
  }, [togglePlay, handlePrev, handleNext, electrobun]);

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
      {contextMenu &&
        createPortal(
          <WinampContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isPlaying={player.isPlaying}
            onAction={handleContextMenuAction}
            onClose={() => setContextMenu(null)}
          />,
          document.body
        )}
    </ThemeProvider>
  );
}
