import { useEffect, useRef, useCallback } from "react";
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ListMusic,
  Maximize2,
  Heart,
} from "lucide-react";
import { usePlayerStore } from "./store/playerStore";
import { Scrubber } from "./components/Scrubber";
import { TitleBar } from "./components/TitleBar";
import type { Track } from "./types";
import type { DesktopBridge } from "../shared/desktop-contract";

type MiniPlayerProps = {
  desktop: DesktopBridge;
  onExpandToMain?: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  playQueue: Track[];
  currentTime: number;
  volume: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
  onTrackSelect: (track: Track, queue: Track[] | null) => void;
};

const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;

function useResizeToContent(
  desktop: DesktopBridge,
  enabled: boolean,
  contentKey: number
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reportSize = useCallback(
    (w: number, h: number) => {
      desktop.send.resizeWindow({
        width: Math.max(MIN_WIDTH, Math.round(w)),
        height: Math.max(MIN_HEIGHT, Math.round(h)),
      });
    },
    [desktop]
  );

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.scrollWidth || el.clientWidth;
    const h = el.scrollHeight || el.clientHeight;
    if (w > 0 && h > 0) reportSize(w, h);
  }, [reportSize]);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    const el = containerRef.current;
    const schedule = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(measure, 50);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    measure();
    requestAnimationFrame(() => setTimeout(measure, 0));
    return () => {
      ro.disconnect();
      clearTimeout(debounceRef.current);
    };
  }, [enabled, measure, contentKey]);

  return containerRef;
}

export function MiniPlayer({
  desktop,
  onExpandToMain,
  currentTrack,
  isPlaying,
  playQueue,
  currentTime,
  volume,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
  onTrackSelect,
}: MiniPlayerProps) {
  const duration = currentTrack?.duration ?? 0;
  const containerRef = useResizeToContent(desktop, true, playQueue.length);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const isFav = usePlayerStore((s) => currentTrack ? s.favorites.has(currentTrack.id) : false);

  return (
    <div
      ref={containerRef}
      className="min-w-[380px] w-[380px] bg-app-bg overflow-hidden flex flex-col font-sans text-app-text-primary select-none"
    >
      <TitleBar
        desktop={desktop}
        title={currentTrack ? currentTrack.title : "Muse"}
        subtitle={currentTrack ? currentTrack.artist : "Mini Player"}
        compact
      />

      <div className="p-5">
        <div className="flex items-center gap-4 mb-5">
          {currentTrack?.picture ? (
            <img src={currentTrack.picture} alt="" className="w-14 h-14 rounded-lg object-cover shadow-md" />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-app-elevated flex items-center justify-center">
              <Music size={24} className="text-app-text-tertiary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium truncate">{currentTrack?.title ?? "No track"}</div>
            <div className="text-[12px] text-app-text-tertiary truncate mt-0.5">{currentTrack?.artist ?? ""}</div>
          </div>
          {currentTrack && (
            <button
              onClick={() => toggleFavorite(currentTrack.id)}
              className={`shrink-0 ${isFav ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}`}
            >
              <Heart size={16} className={isFav ? "fill-current" : ""} />
            </button>
          )}
        </div>

        <div className="mb-4">
          <Scrubber value={currentTime} max={duration} onChange={onScrubberChange} size="sm" />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <button onClick={onPrev} className="text-app-text-secondary hover:text-app-text-primary">
              <SkipBack size={18} className="fill-current" />
            </button>
            <button
              onClick={onPlayPause}
              className="w-10 h-10 rounded-full bg-app-text-primary text-app-bg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
              {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
            </button>
            <button onClick={onNext} className="text-app-text-secondary hover:text-app-text-primary">
              <SkipForward size={18} className="fill-current" />
            </button>
          </div>

          <div className="flex items-center gap-2 w-24">
            <button
              onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}
              className="text-app-text-tertiary hover:text-app-text-primary"
            >
              {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <div
              className="flex-1 relative h-1 bg-app-border-strong rounded-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onVolumeChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
              }}
            >
              <div
                className="absolute top-0 left-0 h-full bg-app-text-secondary rounded-full"
                style={{ width: `${volume * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col shrink-0 border-t border-app-border">
        <div className="flex items-center justify-between px-5 py-2.5">
          <div className="flex items-center gap-2">
            <ListMusic size={14} className="text-app-text-tertiary" />
            <span className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider">Queue</span>
          </div>
          <button
            onClick={() => onExpandToMain?.()}
            className="text-app-text-tertiary hover:text-app-text-primary text-[11px]"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        <div className="h-[380px] overflow-y-auto px-2 pb-2 space-y-0.5">
          {playQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-app-text-tertiary gap-2">
              <ListMusic size={32} strokeWidth={1} className="opacity-30" />
              <div className="text-[12px]">Queue is empty</div>
            </div>
          ) : (
            playQueue.map((track, index) => {
              const isActive = track.id === currentTrack?.id;
              return (
                <button
                  key={`${track.id}-mini-${index}`}
                  onClick={() => isActive ? onPlayPause() : onTrackSelect(track, playQueue)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all ${
                    isActive ? "bg-app-active" : "hover:bg-app-hover"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`w-5 text-[11px] text-right shrink-0 tabular-nums ${isActive ? "text-app-accent" : "text-app-text-tertiary"}`}>
                      {isActive ? (
                        <Volume2 size={12} className={isPlaying ? "animate-pulse-soft" : ""} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className={`text-[13px] truncate ${isActive ? "text-app-accent font-medium" : "text-app-text-primary"}`}>
                      {track.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-app-text-tertiary shrink-0 ml-2">
                    <span className="truncate max-w-[100px]">{track.artist}</span>
                    <span className="tabular-nums">{track.time}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
