import { memo, useCallback } from "react";
import { Shuffle, Repeat, Repeat1, SkipBack, SkipForward, Minimize2, LayoutList, Heart } from "lucide-react";
import type { Track, RepeatMode } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { Scrubber } from "./Scrubber";
import { VolumeSlider } from "./VolumeSlider";
import { PlayPauseButton } from "./PlayPauseButton";

type PlayerBarProps = {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleMini?: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onNavigateToQueue?: () => void;
  onNavigateToNowPlaying?: () => void;
};

export const PlayerBar = memo(function PlayerBar({
  currentTrack,
  isPlaying,
  currentTime,
  volume,
  shuffle,
  repeat,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
  onToggleMini,
  onToggleShuffle,
  onCycleRepeat,
  onNavigateToQueue,
  onNavigateToNowPlaying,
}: PlayerBarProps) {
  const duration = currentTrack?.duration ?? 0;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const isFav = usePlayerStore((s) => currentTrack ? s.favorites.has(currentTrack.id) : false);

  const handleFav = useCallback(() => {
    if (currentTrack) toggleFavorite(currentTrack.id);
  }, [currentTrack, toggleFavorite]);

  return (
    <div className="h-[90px] bg-app-surface border-t border-app-border flex flex-col shrink-0">
      <div className="px-4 pt-2">
        <Scrubber
          value={currentTime}
          max={duration}
          onChange={onScrubberChange}
          size="sm"
          showLabels={false}
        />
      </div>

      <div className="flex-1 flex items-center justify-between px-5">
        <div className="w-[30%] min-w-0 flex items-center gap-3">
          {currentTrack ? (
            <>
              <button
                onClick={onNavigateToNowPlaying}
                className="shrink-0 group/art"
                title="Now Playing"
              >
                {currentTrack.picture ? (
                  <img
                    src={currentTrack.picture}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shadow-md group-hover/art:shadow-lg group-hover/art:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-app-elevated flex items-center justify-center group-hover/art:bg-app-active transition-colors">
                    <span className="text-app-text-tertiary text-lg">♪</span>
                  </div>
                )}
              </button>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-app-text-primary truncate leading-tight">
                  {currentTrack.title}
                </div>
                <div className="text-[11px] text-app-text-tertiary truncate leading-tight mt-0.5">
                  {currentTrack.artist}
                </div>
              </div>
              <button
                onClick={handleFav}
                className={`shrink-0 ml-1 ${isFav ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}`}
              >
                <Heart size={14} className={isFav ? "fill-current" : ""} />
              </button>
            </>
          ) : (
            <div className="text-[13px] text-app-text-tertiary">Not playing</div>
          )}
        </div>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onToggleShuffle}
            className={`transition-colors ${
              shuffle ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"
            }`}
            title={shuffle ? "Shuffle on" : "Shuffle off"}
          >
            <Shuffle size={15} />
          </button>
          <button
            type="button"
            onClick={onPrev}
            className="text-app-text-secondary hover:text-app-text-primary"
            title="Previous"
          >
            <SkipBack size={18} className="fill-current" />
          </button>
          <PlayPauseButton isPlaying={isPlaying} onToggle={onPlayPause} />
          <button
            type="button"
            onClick={onNext}
            className="text-app-text-secondary hover:text-app-text-primary"
            title="Next"
          >
            <SkipForward size={18} className="fill-current" />
          </button>
          <button
            type="button"
            onClick={onCycleRepeat}
            className={`transition-colors ${
              repeat !== "off" ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"
            }`}
            title={repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one"}
          >
            <RepeatIcon size={15} />
          </button>
        </div>

        <div className="w-[30%] flex items-center justify-end gap-3">
          <div className="text-[11px] text-app-text-tertiary tabular-nums select-none whitespace-nowrap">
            {currentTrack ? `${formatCompact(currentTime)} / ${formatCompact(duration)}` : ""}
          </div>
          <VolumeSlider value={volume} onChange={onVolumeChange} />
          {onNavigateToQueue && (
            <button
              type="button"
              onClick={onNavigateToQueue}
              className="text-app-text-tertiary hover:text-app-text-primary"
              title="Up Next"
            >
              <LayoutList size={16} />
            </button>
          )}
          {onToggleMini && (
            <button
              type="button"
              onClick={onToggleMini}
              className="text-app-text-tertiary hover:text-app-text-primary"
              title="Mini Player"
            >
              <Minimize2 size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function formatCompact(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
