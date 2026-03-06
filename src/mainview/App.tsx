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

type WinampElectrobun = {
  rpc?: any;
};

type AppProps = {
  electrobun: WinampElectrobun;
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
  const toggleLikedTrack = usePlayerStore((s) => s.toggleLikedTrack);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);
  const likedTrackPaths = usePlayerStore((s) => s.preferences.likedTrackPaths);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        !!target?.closest("[contenteditable='true']");

      if (isEditable) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowRight" && event.altKey) {
        event.preventDefault();
        handleNext();
      } else if (event.code === "ArrowLeft" && event.altKey) {
        event.preventDefault();
        if (player.currentTime > 3) {
          seek(0);
        } else {
          handlePrev();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNext, handlePrev, player.currentTime, seek, togglePlay]);

  const switchToMini = useCallback(() => {
    electrobun.rpc?.send?.setMinSize?.({ width: MINI_WIDTH, height: 600 });
    electrobun.rpc?.send?.resizeWindow?.({
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
    });
    setWindowMode("mini");
  }, [electrobun]);

  const switchToMain = useCallback(() => {
    electrobun.rpc?.send?.setMinSize?.({ width: 800, height: 600 });
    electrobun.rpc?.send?.resizeWindow?.({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
    });
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
            currentTimeMs={player.currentTime}
            volume={player.volume}
            isLiked={!!player.currentTrack && likedTrackPaths.includes(player.currentTrack.path)}
            shuffleEnabled={player.shuffleEnabled}
            repeatMode={player.repeatMode}
            onPlayPause={togglePlay}
            onNext={handleNext}
            onPrev={() => {
              if (player.currentTime > 3) {
                seek(0);
              } else {
                handlePrev();
              }
            }}
            onScrubberChange={seek}
            onVolumeChange={setVolume}
            onToggleLike={() => player.currentTrack && toggleLikedTrack(player.currentTrack)}
            onToggleShuffle={toggleShuffle}
            onCycleRepeatMode={cycleRepeatMode}
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
            currentTimeMs={player.currentTime}
            volume={player.volume}
            onPlayTrack={(track, queue) => playTrack(track, queue)}
            onPlayPause={togglePlay}
            onNext={handleNext}
            onPrev={() => {
              if (player.currentTime > 3) {
                seek(0);
              } else {
                handlePrev();
              }
            }}
            onScrubberChange={seek}
            onVolumeChange={setVolume}
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
