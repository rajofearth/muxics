import { memo, useCallback, useMemo } from "react";
import { X, Heart, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Music, ChevronRight } from "lucide-react";
import type { Track, RepeatMode } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { Scrubber } from "./Scrubber";
import { VolumeSlider } from "./VolumeSlider";
import { PlayPauseButton } from "./PlayPauseButton";
import { showToast } from "./Toast";

type NowPlayingViewProps = {
  currentTrack: Track;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  onClose: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onScrubberChange: (seconds: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
};

export const NowPlayingView = memo(function NowPlayingView({
  currentTrack,
  isPlaying,
  currentTime,
  volume,
  shuffle,
  repeat,
  onClose,
  onPlayPause,
  onNext,
  onPrev,
  onScrubberChange,
  onVolumeChange,
  onToggleShuffle,
  onCycleRepeat,
}: NowPlayingViewProps) {
  const duration = currentTrack.duration ?? 0;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const isFav = usePlayerStore((s) => s.favorites.has(currentTrack.id));
  const queue = usePlayerStore((s) => s.player.queue);

  const nextTrack = useMemo(() => {
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    return idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;
  }, [queue, currentTrack.id]);

  const handleFav = useCallback(() => {
    toggleFavorite(currentTrack.id);
    showToast(isFav ? "Removed from favorites" : "Added to favorites", "success", "favorite");
  }, [currentTrack.id, toggleFavorite, isFav]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {currentTrack.picture && (
        <div
          className="absolute inset-0 opacity-[0.12] blur-[80px] scale-125 pointer-events-none"
          style={{
            backgroundImage: `url(${currentTrack.picture})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={onClose}
          aria-label="Close Now Playing"
          className="p-2 rounded-lg bg-app-bg/40 hover:bg-app-bg/70 text-app-text-secondary hover:text-app-text-primary backdrop-blur-sm"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 relative z-10">
        <div className="w-64 h-64 xl:w-72 xl:h-72 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5">
          {currentTrack.picture ? (
            <img src={currentTrack.picture} alt={`${currentTrack.title} artwork`} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-app-elevated flex items-center justify-center">
              <Music size={64} className="text-app-text-tertiary" />
            </div>
          )}
        </div>

        <div className="text-center max-w-md w-full">
          <div className="flex items-center justify-center gap-3">
            <h2 className="text-xl font-bold text-app-text-primary truncate">{currentTrack.title}</h2>
            <button
              onClick={handleFav}
              aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFav}
              className={isFav ? "text-app-accent shrink-0" : "text-app-text-tertiary hover:text-app-text-primary shrink-0"}
            >
              <Heart size={18} className={isFav ? "fill-current" : ""} />
            </button>
          </div>
          <p className="text-[14px] text-app-text-secondary mt-1 truncate">{currentTrack.artist}</p>
          {currentTrack.album && (
            <p className="text-[12px] text-app-text-tertiary mt-0.5 truncate">{currentTrack.album}</p>
          )}
        </div>

        <div className="w-full max-w-md">
          <Scrubber value={currentTime} max={duration} onChange={onScrubberChange} />
        </div>

        <div className="flex items-center gap-8">
          <button
            onClick={onToggleShuffle}
            aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
            aria-pressed={shuffle}
            className={shuffle ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <Shuffle size={18} />
          </button>
          <button onClick={onPrev} aria-label="Previous" className="text-app-text-secondary hover:text-app-text-primary">
            <SkipBack size={24} className="fill-current" />
          </button>
          <PlayPauseButton isPlaying={isPlaying} onToggle={onPlayPause} size="lg" />
          <button onClick={onNext} aria-label="Next" className="text-app-text-secondary hover:text-app-text-primary">
            <SkipForward size={24} className="fill-current" />
          </button>
          <button
            onClick={onCycleRepeat}
            aria-label={repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one"}
            className={repeat !== "off" ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <RepeatIcon size={18} />
          </button>
        </div>

        <VolumeSlider value={volume} onChange={onVolumeChange} />

        {nextTrack && (
          <button
            onClick={onNext}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-app-elevated/60 hover:bg-app-elevated backdrop-blur-sm transition-colors max-w-sm w-full"
          >
            {nextTrack.picture ? (
              <img src={nextTrack.picture} alt="" className="w-8 h-8 rounded object-cover" />
            ) : (
              <div className="w-8 h-8 rounded bg-app-bg flex items-center justify-center">
                <Music size={14} className="text-app-text-tertiary" />
              </div>
            )}
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[10px] text-app-text-tertiary uppercase tracking-wider">Next</div>
              <div className="text-[12px] text-app-text-secondary truncate">{nextTrack.title} · {nextTrack.artist}</div>
            </div>
            <ChevronRight size={14} className="text-app-text-tertiary shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
});
