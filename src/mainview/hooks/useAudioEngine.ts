import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { usePlayerStore } from "../store/playerStore";
import { showToast } from "../components/Toast";
import type { Track } from "../types";

const STREAM_EXPIRY_MARGIN_MS = 90_000;
const STREAM_REFRESH_MIN_DELAY_MS = 30_000;

function scheduleYtStreamUrlRefresh(args: {
  expiresAt: number | undefined;
  loadToken: number;
  track: Track;
  audioEl: HTMLAudioElement;
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  loadTokenRef: MutableRefObject<number>;
  clearTimer: () => void;
}): void {
  args.clearTimer();
  if (!args.expiresAt) return;
  const msUntilExpiry = args.expiresAt - Date.now();
  if (msUntilExpiry < 15_000) return;
  const delay = Math.max(
    STREAM_REFRESH_MIN_DELAY_MS,
    Math.min(msUntilExpiry - 10_000, msUntilExpiry - STREAM_EXPIRY_MARGIN_MS),
  );

  args.timerRef.current = setTimeout(() => {
    args.timerRef.current = null;
    if (args.loadTokenRef.current !== args.loadToken) return;
    const st = usePlayerStore.getState();
    if (st.player.currentTrack?.id !== args.track.id || !st.rpc) return;
    const el = args.audioEl;
    if (!el.isConnected) return;
    void (async () => {
      const rpc = st.rpc;
      if (!rpc) return;
      try {
        const playback = await rpc.request.ytmusicGetPlayback({
          trackId: args.track.id,
          providerId: args.track.providerId,
        });
        if (
          args.loadTokenRef.current !== args.loadToken ||
          usePlayerStore.getState().player.currentTrack?.id !== args.track.id
        ) {
          return;
        }
        if (playback.mode !== "direct" || !playback.url) return;
        usePlayerStore.getState().setPlaybackUrl(playback.url);
        el.src = playback.url;
        el.load();
        if (usePlayerStore.getState().player.isPlaying) {
          await el.play().catch(() => {});
        }
        scheduleYtStreamUrlRefresh({
          ...args,
          expiresAt: playback.expiresAt,
        });
      } catch {
        // Stream may still be valid until expiry.
      }
    })();
  }, delay);
}

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
  const loadTokenRef = useRef(0);
  const streamRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRecoveryRef = useRef<{ loadToken: number; retried: boolean }>({ loadToken: 0, retried: false });
  const [analyserReady, setAnalyserReady] = useState(false);

  const clearStreamRefreshTimer = useCallback(() => {
    if (streamRefreshTimerRef.current !== null) {
      clearTimeout(streamRefreshTimerRef.current);
      streamRefreshTimerRef.current = null;
    }
  }, []);

  // ── 1. Create audio element + AudioContext once ──────────────────────
  useEffect(() => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.crossOrigin = "anonymous";
    audioRef.current = el;

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

    gain.gain.value = usePlayerStore.getState().player.volume;
    setAnalyserReady(true);

    const onEnded = () => {
      const { queue, currentTrack, repeat } = usePlayerStore.getState().player;

      if (repeat === "one") {
        el.currentTime = 0;
        el.play().catch(() => {});
        return;
      }

      if (queue.length === 0) return;
      const idx = queue.findIndex((t) => t.id === currentTrack?.id);

      if (idx >= 0 && idx < queue.length - 1) {
        el.pause();
        usePlayerStore.getState().playTrack(queue[idx + 1], queue);
      } else if (repeat === "all" && queue.length > 0) {
        el.pause();
        usePlayerStore.getState().playTrack(queue[0], queue);
      } else {
        usePlayerStore.getState().setCurrentTime(0);
        usePlayerStore.setState((s) => ({ player: { ...s.player, isPlaying: false } }));
      }
    };

    const onTimeUpdate = () => {
      if (audioRef.current) {
        usePlayerStore.getState().setCurrentTime(audioRef.current.currentTime);
      }
    };

    const onError = () => {
      console.warn("Audio element error", el.error);
      const rpc = usePlayerStore.getState().rpc;
      const { currentTrack, isPlaying } = usePlayerStore.getState().player;
      if (!rpc || !currentTrack || currentTrack.provider !== "ytmusic") {
        return;
      }
      const token = errorRecoveryRef.current.loadToken;
      if (token !== loadTokenRef.current || errorRecoveryRef.current.retried) {
        showToast(
          currentTrack.title
            ? `Could not play “${currentTrack.title}”.`
            : "Playback failed for this track.",
          "error",
        );
        return;
      }
      errorRecoveryRef.current.retried = true;
      void (async () => {
        try {
          const playback = await rpc.request.ytmusicGetPlayback({
            trackId: currentTrack.id,
            providerId: currentTrack.providerId,
          });
          if (token !== loadTokenRef.current || usePlayerStore.getState().player.currentTrack?.id !== currentTrack.id) {
            return;
          }
          if (playback.mode !== "direct" || !playback.url) {
            throw new Error(playback.error ?? "Playback unavailable.");
          }
          usePlayerStore.getState().setPlaybackUrl(playback.url);
          el.src = playback.url;
          el.load();
          if (isPlaying) {
            await el.play().catch(() => {});
          }
          scheduleYtStreamUrlRefresh({
            expiresAt: playback.expiresAt,
            loadToken: token,
            track: currentTrack,
            audioEl: el,
            timerRef: streamRefreshTimerRef,
            loadTokenRef,
            clearTimer: clearStreamRefreshTimer,
          });
        } catch (e) {
          if (token === loadTokenRef.current) {
            showToast(e instanceof Error ? e.message : "Playback failed.", "error");
          }
        }
      })();
    };

    const onSeekRequest = (e: Event) => {
      const seconds = (e as CustomEvent<number>).detail;
      el.currentTime = seconds;
      if (usePlayerStore.getState().player.isPlaying) {
        el.play().catch(() => {});
      }
    };

    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("error", onError);
    document.addEventListener("player-seek", onSeekRequest);

    return () => {
      clearStreamRefreshTimer();
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("error", onError);
      document.removeEventListener("player-seek", onSeekRequest);
      el.pause();
      el.src = "";
      audioRef.current = null;
      gainRef.current = null;
      ctx.close();
      analyserRef.current = null;
      ctxRef.current = null;
      setAnalyserReady(false);
    };
  }, [clearStreamRefreshTimer]);

  const currentTrackId = usePlayerStore((s) => s.player.currentTrack?.id);
  const rpc = usePlayerStore((s) => s.rpc);

  useEffect(() => {
    const { currentTrack } = usePlayerStore.getState().player;
    if (!currentTrack || !rpc) return;

    let cancelled = false;

    const loadAndPlay = async () => {
      const token = ++loadTokenRef.current;
      clearStreamRefreshTimer();
      errorRecoveryRef.current = { loadToken: token, retried: false };

      const el = audioRef.current;
      if (!el) return;

      el.pause();
      el.removeAttribute("src");
      el.load();

      try {
        let url: string | null = null;
        let expiresAt: number | undefined;
        if (currentTrack.provider === "ytmusic") {
          const playback = await rpc.request.ytmusicGetPlayback({
            trackId: currentTrack.id,
            providerId: currentTrack.providerId,
          });
          if (playback.mode === "direct" && playback.url) {
            url = playback.url;
            expiresAt = playback.expiresAt;
          } else {
            throw new Error(playback.error ?? "Playback unavailable for this YouTube Music track.");
          }
        } else if (currentTrack.path) {
          url = await rpc.request.getPlaybackUrl({ path: currentTrack.path });
        }

        if (cancelled || loadTokenRef.current !== token) return;
        if (!url) {
          throw new Error("No playback URL was resolved.");
        }

        usePlayerStore.getState().setPlaybackUrl(url);
        const currentEl = audioRef.current;
        if (!currentEl || loadTokenRef.current !== token) return;

        const ctx = ctxRef.current;
        if (ctx && ctx.state === "suspended") {
          await ctx.resume();
        }

        currentEl.src = url;
        currentEl.load();
        await currentEl.play();

        if (currentTrack.provider === "ytmusic") {
          scheduleYtStreamUrlRefresh({
            expiresAt,
            loadToken: token,
            track: currentTrack,
            audioEl: currentEl,
            timerRef: streamRefreshTimerRef,
            loadTokenRef,
            clearTimer: clearStreamRefreshTimer,
          });
        }
      } catch (err) {
        if (!cancelled && loadTokenRef.current === token) {
          console.warn("Playback start failed:", err);
          if (currentTrack.provider === "ytmusic") {
            showToast(err instanceof Error ? err.message : "Playback failed.", "error");
          }
        }
      }
    };

    void loadAndPlay();

    return () => {
      cancelled = true;
      clearStreamRefreshTimer();
    };
  }, [currentTrackId, rpc, clearStreamRefreshTimer]);

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

  const volume = usePlayerStore((s) => s.player.volume);

  useEffect(() => {
    const gain = gainRef.current;
    if (gain) gain.gain.value = volume;
  }, [volume]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    if (usePlayerStore.getState().player.isPlaying) {
      el.play().catch(() => {});
    }
  }, []);

  return { audioRef, analyserRef, analyserReady, seek };
}
