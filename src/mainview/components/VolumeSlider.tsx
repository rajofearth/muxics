type VolumeSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

export function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  const percent = Math.max(0, Math.min(1, value)) * 100;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onChange(Math.max(0, Math.min(1, pct)));
  };

  return (
    <div className="w-28">
      <div
        className="group relative h-1.5 cursor-pointer rounded-full bg-white/8"
        onClick={handleClick}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-sky-400/60 to-cyan-300/60 transition"
          style={{ width: `${percent}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -ml-2 rounded-full bg-white transition group-hover:scale-110"
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  );
}
