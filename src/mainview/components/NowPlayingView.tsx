import { memo, useCallback } from "react";
import { X, Heart, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Music } from "lucide-react";
import type { Track, RepeatMode } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { Scrubber } from "./Scrubber";
import { VolumeSlider } from "./VolumeSlider";
import { PlayPauseButton } from "./PlayPauseButton";

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

  const handleFav = useCallback(() => {
    toggleFavorite(currentTrack.id);
  }, [currentTrack.id, toggleFavorite]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {currentTrack.picture && (
        <div
          className="absolute inset-0 opacity-15 blur-3xl scale-110"
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
          className="p-2 rounded-lg bg-app-bg/50 hover:bg-app-bg/80 text-app-text-secondary hover:text-app-text-primary backdrop-blur-sm"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8 relative z-10">
        <div className="w-72 h-72 rounded-2xl overflow-hidden shadow-2xl">
          {currentTrack.picture ? (
            <img
              src={currentTrack.picture}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-app-elevated flex items-center justify-center">
              <Music size={64} className="text-app-text-tertiary" />
            </div>
          )}
        </div>

        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold text-app-text-primary truncate">{currentTrack.title}</h2>
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
            className={shuffle ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <Shuffle size={18} />
          </button>
          <button onClick={onPrev} className="text-app-text-secondary hover:text-app-text-primary">
            <SkipBack size={24} className="fill-current" />
          </button>
          <PlayPauseButton isPlaying={isPlaying} onToggle={onPlayPause} size="lg" />
          <button onClick={onNext} className="text-app-text-secondary hover:text-app-text-primary">
            <SkipForward size={24} className="fill-current" />
          </button>
          <button
            onClick={onCycleRepeat}
            className={repeat !== "off" ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <RepeatIcon size={18} />
          </button>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={handleFav}
            className={isFav ? "text-app-accent" : "text-app-text-tertiary hover:text-app-text-primary"}
          >
            <Heart size={20} className={isFav ? "fill-current" : ""} />
          </button>
          <VolumeSlider value={volume} onChange={onVolumeChange} />
        </div>
      </div>
    </div>
  );
});
