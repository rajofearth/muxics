import { Play, Pause } from "lucide-react";

type PlayPauseButtonProps = {
  isPlaying: boolean;
  onToggle: () => void;
};

export function PlayPauseButton({ isPlaying, onToggle }: PlayPauseButtonProps) {
  return (
    <button
      type="button"
      className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_12px_36px_rgba(255,255,255,0.2)] transition hover:scale-[1.02]"
      onClick={onToggle}
    >
      {isPlaying ? (
        <Pause size={20} className="fill-current" />
      ) : (
        <Play size={20} className="fill-current ml-1" />
      )}
    </button>
  );
}
