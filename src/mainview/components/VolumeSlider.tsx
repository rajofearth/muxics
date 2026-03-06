import { useCallback, useRef, useState } from "react";
import { Volume2, Volume1, VolumeX } from "lucide-react";

type VolumeSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

export function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const percent = Math.max(0, Math.min(1, value)) * 100;
  const prevVolume = useRef(value || 0.75);

  const calcValue = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      onChange(calcValue(e.clientX));
    },
    [calcValue, onChange]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging) onChange(calcValue(e.clientX));
    },
    [dragging, calcValue, onChange]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const toggleMute = () => {
    if (value > 0) {
      prevVolume.current = value;
      onChange(0);
    } else {
      onChange(prevVolume.current);
    }
  };

  const Icon = value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-2 w-32 group/vol">
      <button
        onClick={toggleMute}
        className="text-app-text-tertiary hover:text-app-text-primary shrink-0"
        type="button"
      >
        <Icon size={16} />
      </button>
      <div
        ref={trackRef}
        className={`slider-container flex-1 h-1 bg-app-border-strong relative rounded-full cursor-pointer ${dragging ? "dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="slider-track absolute top-0 left-0 h-full bg-app-text-secondary rounded-full"
          style={{ width: `${percent}%` }}
        />
        <div
          className="slider-thumb absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-app-text-primary rounded-full shadow pointer-events-none"
          style={{ left: `calc(${percent}% - 6px)` }}
        />
      </div>
    </div>
  );
}
