import { formatTime } from "../utils";

type ScrubberProps = {
  value: number;
  max: number;
  currentLabel?: string;
  maxLabel?: string;
  onChange: (value: number) => void;
};

export function Scrubber({ value, max, currentLabel, maxLabel, onChange }: ScrubberProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onChange(Math.max(0, Math.min(max, pct * max)));
  };

  return (
    <div className="flex w-full items-center gap-4 text-xs text-white/42">
      <span className="w-10 text-right">{currentLabel ?? formatTime(value)}</span>
      <div
        className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/8"
        onClick={handleClick}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sky-400/70 to-cyan-300/70 transition"
          style={{ width: `${percent}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 -ml-2 rounded-full bg-white shadow-[0_8px_24px_rgba(14,165,233,0.45)] transition group-hover:scale-110"
          style={{ left: `${percent}%` }}
        />
      </div>
      <span className="w-10">{maxLabel ?? formatTime(max)}</span>
    </div>
  );
}
