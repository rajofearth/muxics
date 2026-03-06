import { Heart, Minimize2, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import type { RepeatMode, Track } from "../types";
import { Scrubber } from "./Scrubber";
import { VolumeSlider } from "./VolumeSlider";
import { PlayPauseButton } from "./PlayPauseButton";

type PlayerBarProps = {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTimeMs: number;
  volume: number;
  queueLength: number;
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
  onToggleMini?: () => void;
};

export function PlayerBar({
  currentTrack,
  isPlaying,
  currentTimeMs,
  volume,
  queueLength,
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
  onToggleMini,
}: PlayerBarProps) {
  const totalCurrentSecs = currentTrack?.duration ?? 0;

  return (
    <div className="shrink-0 border-t border-white/8 bg-[rgba(8,12,20,0.78)] px-6 py-4 backdrop-blur-2xl">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/6">
            {currentTrack?.picture ? (
              <img src={currentTrack.picture} alt="" className="h-full w-full object-cover" />
            ) : (
              <Volume2 size={18} className="text-white/28" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {currentTrack?.title ?? "Pick something to play"}
            </div>
            <div className="truncate text-sm text-white/45">
              {currentTrack ? `${currentTrack.artist} • ${currentTrack.album}` : "Your queue will build here."}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleLike}
            disabled={!currentTrack}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/35 transition hover:bg-white/8 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isLiked ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart size={16} className={isLiked ? "fill-rose-400 text-rose-400" : ""} />
          </button>
        </div>

        <div className="flex min-w-0 flex-col items-center gap-3">
          <Scrubber
            value={currentTimeMs}
            max={totalCurrentSecs}
            maxLabel={currentTrack?.time ?? "0:00"}
            onChange={onScrubberChange}
          />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onToggleShuffle}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                shuffleEnabled ? "bg-sky-400/15 text-sky-300" : "text-white/35 hover:bg-white/8 hover:text-white/75"
              }`}
              aria-label="Toggle shuffle"
            >
              <Shuffle size={15} />
            </button>
            <SkipBack
              onClick={onPrev}
              size={18}
              className="cursor-pointer fill-current text-white/78 transition hover:text-white"
            />
            <PlayPauseButton isPlaying={isPlaying} onToggle={onPlayPause} />
            <SkipForward
              onClick={onNext}
              size={18}
              className="cursor-pointer fill-current text-white/78 transition hover:text-white"
            />
            <button
              type="button"
              onClick={onCycleRepeatMode}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                repeatMode !== "off"
                  ? "bg-sky-400/15 text-sky-300"
                  : "text-white/35 hover:bg-white/8 hover:text-white/75"
              }`}
              aria-label={`Repeat mode: ${repeatMode}`}
            >
              {repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4">
          <div className="hidden text-right md:block">
            <div className="text-[11px] uppercase tracking-[0.22em] text-white/35">Queue</div>
            <div className="mt-1 text-sm text-white/72">{queueLength} tracks lined up</div>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/8 bg-white/4 px-4 py-2">
            <Volume2 size={15} className="text-white/42" />
            <VolumeSlider value={volume} onChange={onVolumeChange} />
          </div>
          <button
            type="button"
            onClick={onToggleMini}
            aria-label="Open mini player"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/35 transition hover:bg-white/8 hover:text-white/75"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
