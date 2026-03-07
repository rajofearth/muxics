import { Play, Pause } from "lucide-react";

type PlayPauseButtonProps = {
  isPlaying: boolean;
  onToggle: () => void;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: { button: "w-7 h-7", icon: 14 },
  md: { button: "w-9 h-9", icon: 18 },
  lg: { button: "w-12 h-12", icon: 22 },
};

export function PlayPauseButton({ isPlaying, onToggle, size = "md" }: PlayPauseButtonProps) {
  const s = sizes[size];
  return (
    <button
      type="button"
      aria-label={isPlaying ? "Pause" : "Play"}
      className={`${s.button} rounded-full bg-app-text-primary flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95 transition-transform text-app-bg`}
      onClick={onToggle}
    >
      {isPlaying ? (
        <Pause size={s.icon} className="fill-current" />
      ) : (
        <Play size={s.icon} className="fill-current ml-0.5" />
      )}
    </button>
  );
}
