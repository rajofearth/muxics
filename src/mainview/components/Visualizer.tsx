import { useMemo } from "react";
import { useAudioEngineContext } from "../context/AudioEngineContext";
import { useAnalyserData } from "../hooks/useAnalyserData";
import { usePlayerStore } from "../store/playerStore";

type VisualizerProps = {
  count?: number;
  height?: string;
};

function downsampleFrequencyData(data: Uint8Array, targetCount: number): number[] {
  if (data.length === 0) return [];
  const step = data.length / targetCount;
  const result: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let sum = 0;
    for (let j = start; j < end && j < data.length; j++) sum += data[j];
    result.push(sum / (end - start || 1));
  }
  return result;
}

export function Visualizer({ count = 40, height = "h-8" }: VisualizerProps) {
  const { analyserRef, analyserReady } = useAudioEngineContext();
  const isPlaying = usePlayerStore((s) => s.player.isPlaying);
  const frequencyData = useAnalyserData(analyserRef, isPlaying, analyserReady);

  const heights = useMemo(() => {
    if (frequencyData && frequencyData.length > 0 && isPlaying) {
      const sampled = downsampleFrequencyData(frequencyData, count);
      const max = Math.max(...sampled, 1);
      return sampled.map((v) => Math.max(8, (v / max) * 100));
    }
    return Array.from({ length: count }, () => 8);
  }, [frequencyData, count, isPlaying]);

  return (
    <div className={`flex items-end gap-px ${height} opacity-60`}>
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-app-accent rounded-t-sm transition-all duration-75"
          style={{ height: `${h}%`, minHeight: 2 }}
        />
      ))}
    </div>
  );
}
