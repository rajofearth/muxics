import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/playerStore";

/**
 * Core audio engine hook.
 *
 * Key design decisions:
 * - The HTMLAudioElement and AudioContext are created exactly ONCE (empty deps).
 * - All store access inside event handlers goes through usePlayerStore.getState()
 *   so the handlers are stable references and never cause the element effect to
 *   re-run (which would destroy the element and break playback).
 * - Separate effects observe individual slices of state (isPlaying, volume,
 *   currentTrack id, currentTime) and imperatively drive the element.
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [analyserReady, setAnalyserReady] = useState(false);

  // ── 1. Create audio element + AudioContext once ──────────────────────
  useEffect(() => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.crossOrigin = "anonymous";
    audioRef.current = el;

    // Wire up AudioContext → GainNode → AnalyserNode → destination
    // Volume MUST go through GainNode because createMediaElementSource
    // bypasses el.volume on WebKitGTK (and some Chromium builds).
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    ctxRef.current = ctx;
    gainRef.current = gain;

    // Set initial volume from store
    gain.gain.value = usePlayerStore.getState().player.volume;
    setAnalyserReady(true);

    // ── Event handlers (stable — read state at call-time) ──
    const onEnded = () => {
      const { player, setCurrentTime } = usePlayerStore.getState();
      if (player.repeatMode === "one" && player.currentTrack) {
        el.currentTime = 0;
        setCurrentTime(0);
        el.play().catch(() => {});
        return;
      }

      el.pause();
      usePlayerStore.getState().handleTrackEnd();
    };

    const onTimeUpdate = () => {
      if (audioRef.current) {
        usePlayerStore.getState().setCurrentTime(audioRef.current.currentTime);
      }
    };

    const onError = () => {
      console.warn("Audio element error", el.error);
    };

    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("error", onError);
      el.pause();
      el.src = "";
      audioRef.current = null;
      gainRef.current = null;
      ctx.close();
      analyserRef.current = null;
      ctxRef.current = null;
      setAnalyserReady(false);
    };
  }, []); // intentionally empty — element lives for the lifetime of the app

  // ── 2. Load & play when the current track changes ────────────────────
  const currentTrackId = usePlayerStore((s) => s.player.currentTrack?.id);
  const rpc = usePlayerStore((s) => s.rpc);

  useEffect(() => {
    const { currentTrack, currentTime, isPlaying } = usePlayerStore.getState().player;
    if (!currentTrack || !rpc) return;

    let cancelled = false;

    const loadAndPlay = async () => {
      try {
        const url = await rpc.request.getPlaybackUrl({ path: currentTrack.path });
        if (cancelled) return;

        usePlayerStore.getState().setPlaybackUrl(url);
        const el = audioRef.current;
        if (!el) return;

        // Resume AudioContext if suspended (browser autoplay policy)
        const ctx = ctxRef.current;
        if (ctx && ctx.state === "suspended") {
          await ctx.resume();
        }

        el.src = url;
        if (currentTime > 0) {
          const restoreTime = () => {
            el.currentTime = currentTime;
          };
          el.addEventListener("loadedmetadata", restoreTime, { once: true });
        }

        if (isPlaying) {
          await el.play();
        } else {
          el.load();
        }
      } catch (err) {
        console.warn("Playback start failed:", err);
      }
    };

    loadAndPlay();

    return () => {
      cancelled = true;
    };
  }, [currentTrackId, rpc]);

  // ── 3. React to play / pause toggle ──────────────────────────────────
  const isPlaying = usePlayerStore((s) => s.player.isPlaying);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !el.src) return;

    if (isPlaying) {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") {
        ctx.resume();
      }
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying]);

  // ── 4. React to volume changes (via GainNode) ──────────────────────
  const volume = usePlayerStore((s) => s.player.volume);

  useEffect(() => {
    const gain = gainRef.current;
    if (gain) gain.gain.value = volume;
  }, [volume]);

  // ── 5. Seek — direct imperative callback, no store/effect needed ───
  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    // WebKitGTK can drop out of playing state after seeking
    if (usePlayerStore.getState().player.isPlaying) {
      el.play().catch(() => {});
    }
  }, []);

  return { audioRef, analyserRef, analyserReady, seek };
}
