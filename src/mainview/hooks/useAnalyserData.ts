import { useEffect, useState, useRef } from "react";

const THROTTLE_MS = 50;

export function useAnalyserData(
  analyserRef: React.RefObject<AnalyserNode | null>,
  isPlaying: boolean,
  ready = true
) {
  const [data, setData] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const frameRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);
  const bufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!ready) return;
    const analyser = analyserRef.current;
    if (!analyser) return;

    const len = analyser.frequencyBinCount;
    if (!bufferRef.current || bufferRef.current.length !== len) {
      bufferRef.current = new Uint8Array(len);
    }
    const buf = bufferRef.current;

    const tick = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current >= THROTTLE_MS) {
        analyser.getByteFrequencyData(buf);
        const copy = new Uint8Array(buf.length);
        copy.set(buf);
        setData(copy);
        lastUpdateRef.current = now;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    if (isPlaying) {
      frameRef.current = requestAnimationFrame(tick);
    } else {
      setData(null);
    }
    return () => cancelAnimationFrame(frameRef.current);
  }, [analyserRef, isPlaying, ready]);

  return data;
}
