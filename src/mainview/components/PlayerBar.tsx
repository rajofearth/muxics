import { memo, useCallback } from "react";
import { Shuffle, Repeat, Repeat1, SkipBack, SkipForward, Minimize2, LayoutList, Heart } from "lucide-react";
import type { Track, RepeatMode } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { Scrubber } from "./Scrubber";
import { VolumeSlider } from "./VolumeSlider";
import { PlayPauseButton } from "./PlayPauseButton";
import { showToast } from "./Toast";

type PlayerBarProps = {
  currentTrack: Track | null;
  isPlaying: boolean;
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
  const currentTime = usePlayerStore((s) => s.player.currentTime);
  const duration = currentTrack?.duration ?? 0;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const isFav = usePlayerStore((s) => currentTrack ? s.favorites.has(currentTrack.id) : false);

  const handleFav = useCallback(() => {
    if (!currentTrack) return;
    toggleFavorite(currentTrack.id);
    showToast(isFav ? "Removed from favorites" : "Added to favorites", "success", "favorite");
  }, [currentTrack, toggleFavorite, isFav]);

  return (
    <footer className="h-[90px] bg-app-surface border-t border-app-border flex flex-col shrink-0" role="region" aria-label="Player controls">
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
                aria-label="Now Playing"
              >
                {currentTrack.picture ? (
                  <img
                    src={currentTrack.picture}
                    alt={`${currentTrack.title} artwork`}
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
                aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={isFav}
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
            aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
            aria-pressed={shuffle}
            className={shuffle ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <Shuffle size={15} />
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous track"
            className="text-app-text-secondary hover:text-app-text-primary"
          >
            <SkipBack size={18} className="fill-current" />
          </button>
          <PlayPauseButton isPlaying={isPlaying} onToggle={onPlayPause} />
          <button
            type="button"
            onClick={onNext}
            aria-label="Next track"
            className="text-app-text-secondary hover:text-app-text-primary"
          >
            <SkipForward size={18} className="fill-current" />
          </button>
          <button
            type="button"
            onClick={onCycleRepeat}
            aria-label={repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one"}
            className={repeat !== "off" ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <RepeatIcon size={15} />
          </button>
        </div>

        <div className="w-[30%] flex items-center justify-end gap-3">
          <div className="text-[11px] text-app-text-tertiary tabular-nums select-none whitespace-nowrap" aria-live="off">
            {currentTrack ? `${fmtTime(currentTime)} / ${fmtTime(duration)}` : ""}
          </div>
          <VolumeSlider value={volume} onChange={onVolumeChange} />
          {onNavigateToQueue && (
            <button
              type="button"
              onClick={onNavigateToQueue}
              aria-label="Up Next"
              className="text-app-text-tertiary hover:text-app-text-primary"
            >
              <LayoutList size={16} />
            </button>
          )}
          {onToggleMini && (
            <button
              type="button"
              onClick={onToggleMini}
              aria-label="Mini Player"
              className="text-app-text-tertiary hover:text-app-text-primary"
            >
              <Minimize2 size={15} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
});

function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
