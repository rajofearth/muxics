import { memo } from "react";

type EqBarsProps = {
  playing?: boolean;
  size?: number;
  className?: string;
};

export const EqBars = memo(function EqBars({ playing = true, size = 14, className = "" }: EqBarsProps) {
  const barW = Math.max(1.5, size / 6);
  const gap = Math.max(0.5, size / 14);

  return (
    <div
      className={`flex items-end ${className}`}
      style={{ width: size, height: size, gap }}
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`rounded-full bg-app-accent ${playing ? "eq-bar" : ""}`}
          style={{
            width: barW,
            height: playing ? undefined : "30%",
            flex: 1,
            animationDelay: `${i * 0.15}s`,
            animationPlayState: playing ? "running" : "paused",
          }}
        />
      ))}
    </div>
  );
});
