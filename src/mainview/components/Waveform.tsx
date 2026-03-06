import { useEffect, useRef } from "react";
import { useAudioEngineContext } from "../context/AudioEngineContext";
import { usePlayerStore } from "../store/playerStore";

type WaveformProps = {
  width?: number;
  height?: number;
  className?: string;
};

export function Waveform({ width = 200, height = 40, className = "" }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { analyserRef, analyserReady } = useAudioEngineContext();
  const isPlaying = usePlayerStore((s) => s.player.isPlaying);
  const theme = usePlayerStore((s) => s.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef?.current;
    if (!canvas || !analyser || !analyserReady) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    let frameId: number;

    const draw = () => {
      frameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.accentColor;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128;
        const y = (v * height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };

    if (isPlaying) draw();
    return () => cancelAnimationFrame(frameId);
  }, [analyserRef, analyserReady, isPlaying, width, height, theme.accentColor]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} />;
}
