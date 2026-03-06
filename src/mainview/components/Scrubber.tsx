import { useCallback, useRef, useState } from "react";
import { formatTime } from "../utils";

type ScrubberProps = {
  value: number;
  max: number;
  onChange: (value: number) => void;
  showLabels?: boolean;
  size?: "sm" | "md";
};

export function Scrubber({ value, max, onChange, showLabels = true, size = "md" }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const percent = max > 0 ? (value / max) * 100 : 0;
  const h = size === "sm" ? "h-1" : "h-1.5";
  const thumbSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  const calcValue = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * max;
    },
    [max]
  );

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
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverPercent(pct * 100);
      if (dragging) onChange(pct * max);
    },
    [dragging, max, onChange]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);
  const onPointerLeave = useCallback(() => {
    setHoverPercent(null);
    setDragging(false);
  }, []);

  return (
    <div className="w-full flex items-center gap-3">
      {showLabels && (
        <span className="w-10 text-right text-[11px] text-app-text-tertiary tabular-nums select-none">
          {formatTime(value)}
        </span>
      )}
      <div
        ref={trackRef}
        className={`slider-container flex-1 ${h} bg-app-border-strong relative rounded-full cursor-pointer group ${dragging ? "dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {hoverPercent !== null && !dragging && (
          <div
            className="absolute top-0 left-0 h-full bg-app-text-tertiary/20 rounded-full pointer-events-none"
            style={{ width: `${hoverPercent}%` }}
          />
        )}
        <div
          className="slider-track absolute top-0 left-0 h-full bg-app-text-primary rounded-full"
          style={{ width: `${percent}%` }}
        />
        <div
          className={`slider-thumb absolute top-1/2 -translate-y-1/2 ${thumbSize} bg-app-text-primary rounded-full shadow-lg pointer-events-none`}
          style={{ left: `calc(${percent}% - ${size === "sm" ? 6 : 7}px)` }}
        />
      </div>
      {showLabels && (
        <span className="w-10 text-[11px] text-app-text-tertiary tabular-nums select-none">
          {formatTime(max)}
        </span>
      )}
    </div>
  );
}
