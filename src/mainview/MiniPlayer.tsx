import { useState, useEffect, useRef, useCallback } from "react";
import {
  Heart,
  Play,
  Pause,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  ListMusic,
  VolumeX,
  Minus,
  PanelLeft,
  X,
  Music4,
} from "lucide-react";
import { formatTime } from "./utils";
import { APP_DISPLAY_NAME } from "./constants";
import type { RepeatMode, Track } from "./types";

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

type MiniPlayerProps = {
  electrobun: WinampElectrobun;
  onExpandToMain?: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  playQueue: Track[];
  currentTimeMs: number;
  volume: number;
  isLiked: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleLike: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onTrackSelect: (track: Track, queue: Track[] | null) => void;
};

const BASE_EQ_CURVE = [
  90, 85, 80, 70, 60, 40, 35, 30, 35, 30, 35, 30, 25, 20, 15, 10, 8, 6, 5, 4, 3,
  2, 2, 2,
];

const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;

function useResizeToContent(
  electrobun: WinampElectrobun,
  enabled: boolean,
  contentKey: number
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reportSize = useCallback(
    (w: number, h: number) => {
      electrobun.rpc?.send?.resizeWindow?.({
        width: Math.max(MIN_WIDTH, Math.round(w)),
        height: Math.max(MIN_HEIGHT, Math.round(h)),
      });
    },
    [electrobun]
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
  electrobun,
  onExpandToMain,
  currentTrack,
  isPlaying,
  playQueue,
  currentTimeMs,
  volume,
  isLiked,
  shuffleEnabled,
  repeatMode,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
  onToggleLike,
  onToggleShuffle,
  onCycleRepeatMode,
  onTrackSelect,
}: MiniPlayerProps) {
  const send = electrobun.rpc?.send;
  const [eqValues, setEqValues] = useState<number[]>(BASE_EQ_CURVE);

  const totalDurationSecs = Math.max(1, currentTrack?.duration ?? 0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setEqValues((prev) =>
          prev.map((_, i) => {
            const max = BASE_EQ_CURVE[i];
            const min = max * 0.4;
            return Math.random() * (max - min) + min;
          })
        );
      }, 150);
    } else {
      setEqValues(BASE_EQ_CURVE);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const contentKey = playQueue.length;
  const containerRef = useResizeToContent(electrobun, true, contentKey);

  return (
    <div
      ref={containerRef}
      className="flex w-[380px] min-w-[380px] flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#172235_0%,#0c111b_42%,#070b12_100%)] font-mono text-white select-none"
    >
      <div className="electrobun-webkit-app-region-drag flex items-center justify-between border-b border-white/8 px-3 py-3">
        <div className="electrobun-webkit-app-region-no-drag flex items-center gap-2">
          <button
            type="button"
            onClick={() => send?.minimizeWindow?.()}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#f4be4f] text-transparent transition hover:text-[#5f3c00]"
            aria-label="Minimize"
          >
            <Minus size={10} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => onExpandToMain?.() ?? send?.maximizeWindow?.()}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#61c454] text-transparent transition hover:text-[#0b4a07]"
            aria-label="Back to main window"
          >
            <PanelLeft size={8} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => send?.closeWindow?.()}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ed6a5e] text-transparent transition hover:text-[#5f0d08]"
            aria-label="Close"
          >
            <X size={9} strokeWidth={2.4} />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-1 justify-center">
          <Music4 size={14} className="text-sky-300" />
          <span className="text-xs font-medium tracking-[0.22em] text-white/72">{APP_DISPLAY_NAME}</span>
        </div>
        <button
          type="button"
          onClick={() => onExpandToMain?.()}
          className="electrobun-webkit-app-region-no-drag rounded-full p-2 text-white/40 transition hover:bg-white/8 hover:text-white"
          aria-label="Back to main window"
        >
          <PanelLeft size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 p-5">
        <div className="flex items-end gap-[2px] h-16 mb-5 opacity-80">
          {eqValues.map((val, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-full bg-gradient-to-t from-sky-500/60 to-cyan-300/85 transition-all duration-150 ease-in-out"
              style={{ height: `${val}%`, minHeight: "2px" }}
            />
          ))}
        </div>

        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[24px] bg-white/6">
            {currentTrack?.picture ? (
              <img src={currentTrack.picture} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music4 size={20} className="text-white/28" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">{currentTrack?.title ?? "No track selected"}</h2>
            <p className="truncate text-sm text-white/42">{currentTrack?.artist ?? "Your queue is waiting."}</p>
            {currentTrack && <p className="truncate text-xs text-white/32">{currentTrack.album}</p>}
          </div>
        </div>

        <div className="mb-5 flex items-center gap-3 text-xs text-white/42">
          <span className="w-10 text-right">{formatTime(currentTimeMs)}</span>
          <div
            className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/8"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              onScrubberChange((x / rect.width) * totalDurationSecs);
            }}
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sky-400/70 to-cyan-300/70"
              style={{ width: `${(currentTimeMs / totalDurationSecs) * 100}%` }}
            />
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover:scale-110"
              style={{
                left: `calc(${(currentTimeMs / totalDurationSecs) * 100}% - 7px)`,
              }}
            />
          </div>
          <span className="w-10">{formatTime(totalDurationSecs)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onToggleShuffle}
              className={`rounded-full p-2 transition ${
                shuffleEnabled ? "bg-sky-400/15 text-sky-300" : "text-white/35 hover:bg-white/8 hover:text-white"
              }`}
            >
              <Shuffle size={16} />
            </button>
            <button
              type="button"
              onClick={onPrev}
              className="text-white/45 transition hover:text-white"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onPlayPause}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_12px_36px_rgba(255,255,255,0.2)] transition hover:scale-[1.02]"
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button
              type="button"
              onClick={onNext}
              className="text-white/45 transition hover:text-white"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onCycleRepeatMode}
              className={`rounded-full p-2 transition ${
                repeatMode !== "off"
                  ? "bg-sky-400/15 text-sky-300"
                  : "text-white/35 hover:bg-white/8 hover:text-white"
              }`}
            >
              {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLike}
              className="rounded-full p-2 text-white/35 transition hover:bg-white/8 hover:text-rose-300"
            >
              <Heart size={16} className={isLiked ? "fill-rose-400 text-rose-400" : ""} />
            </button>
            <button
              type="button"
              onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}
              className="text-white/45 transition hover:text-white"
            >
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <div
              className="group relative h-1.5 w-24 cursor-pointer rounded-full bg-white/8"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                onVolumeChange(Math.max(0, Math.min(1, x / rect.width)));
              }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sky-400/70 to-cyan-300/70"
                style={{ width: `${volume * 100}%` }}
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover:scale-110"
                style={{ left: `calc(${volume * 100}% - 7px)` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col shrink-0">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <ListMusic size={14} className="text-violet-300" />
            <span className="text-xs font-medium tracking-[0.22em] text-white/48">QUEUE</span>
          </div>
        </div>

        <div className="h-[440px] space-y-1 overflow-y-auto p-2">
          {playQueue.map((track, index) => {
            const isActive = track.id === currentTrack?.id;
            return (
              <div
                key={`${track.id}-${index}`}
                onClick={() => {
                  if (isActive) {
                    onPlayPause();
                  } else {
                    onTrackSelect(track, playQueue);
                  }
                }}
                className={`group flex cursor-pointer items-center justify-between rounded-2xl p-3 transition ${
                  isActive ? "bg-white/10" : "hover:bg-white/6"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`flex w-4 items-center justify-end text-xs text-right ${
                      isActive ? "text-white" : "text-white/35"
                    }`}
                  >
                    {isActive ? (
                      <Volume2 size={14} className={isPlaying ? "animate-pulse" : ""} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span
                    className={`text-sm ${
                      isActive ? "text-white" : "text-white/72 group-hover:text-white"
                    }`}
                  >
                    {track.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/35">
                  <span className="truncate max-w-[120px]">{track.artist}</span>
                  <span>{track.time}</span>
                </div>
              </div>
            );
          })}
          {playQueue.length === 0 && (
            <div className="px-3 py-8 text-sm text-white/42">Open the main window and queue a few tracks.</div>
          )}
        </div>
      </div>
    </div>
  );
}
