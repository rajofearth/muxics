import { create } from "zustand";
import type { RepeatMode, Track } from "../types";
import { shuffleArray } from "../utils";

const MAX_RECENTLY_PLAYED = 50;

function loadInitialVolume(): number {
  try {
    const v = localStorage.getItem("muxics-volume");
    if (v !== null) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {}
  return 0.75;
}

export interface PlayerState {
  player: {
    currentTrack: Track | null;
    queue: Track[];
    originalQueue: Track[];
    isPlaying: boolean;
    currentTime: number;
    volume: number;
    playbackUrl: string | null;
    shuffle: boolean;
    repeat: RepeatMode;
  };
  recentlyPlayed: Track[];
  _initReady: boolean;
  _initStatus: string;
}

interface PlayerActions {
  playTrack: (track: Track, queue?: Track[] | null) => void;
  togglePlay: () => void;
  handleNext: () => void;
  handlePrev: () => void;
  setCurrentTime: (seconds: number) => void;
  setVolume: (value: number) => void;
  setPlaybackUrl: (url: string | null) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToRecentlyPlayed: (track: Track) => void;
  updateQueue: (newQueue: Track[]) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  setInitReady: () => void;
  setInitStatus: (status: string) => void;
}

export const usePlayerStore = create<PlayerState & PlayerActions>()((set, get) => ({
  // Initial state
  player: {
    currentTrack: null,
    queue: [],
    originalQueue: [],
    isPlaying: false,
    currentTime: 0,
    volume: loadInitialVolume(),
    playbackUrl: null,
    shuffle: false,
    repeat: "off",
  },
  recentlyPlayed: [],
  _initReady: false,
  _initStatus: "Initializing Muxics...",

  // Actions
  playTrack: (track, queue = null) => {
    const state = get();
    const q = queue ?? state.player.queue;
    state.addToRecentlyPlayed(track);

    set({
      player: {
        ...state.player,
        currentTrack: track,
        queue: state.player.shuffle && queue ? shuffleArray(q) : q,
        originalQueue: queue ?? state.player.originalQueue,
        isPlaying: true,
        currentTime: 0,
      },
    });
  },

  togglePlay: () =>
    set((s) => ({ player: { ...s.player, isPlaying: !s.player.isPlaying } })),

  handleNext: () => {
    const { queue, currentTrack, repeat } = get().player;
    if (queue.length === 0) return;

    if (repeat === "one") {
      set((s) => ({ player: { ...s.player, currentTime: 0 } }));
      return;
    }

    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    if (idx >= 0 && idx < queue.length - 1) {
      get().playTrack(queue[idx + 1]);
    } else if (repeat === "all") {
      get().playTrack(queue[0]);
    } else if (idx === queue.length - 1) {
      set((s) => ({
        player: { ...s.player, isPlaying: false, currentTime: 0 },
      }));
    }
  },

  handlePrev: () => {
    const { queue, currentTrack, currentTime } = get().player;
    if (queue.length === 0) return;

    if (currentTime > 3 && currentTrack) {
      document.dispatchEvent(new CustomEvent("player-seek", { detail: 0 }));
      set((s) => ({ player: { ...s.player, currentTime: 0 } }));
      return;
    }

    const idx = queue.findIndex((t) => t.id === currentTrack?.id);
    const prev = idx > 0 ? queue[idx - 1] : queue[queue.length - 1];
    if (prev) get().playTrack(prev);
  },

  setCurrentTime: (seconds) =>
    set((s) => ({ player: { ...s.player, currentTime: seconds } })),

  setVolume: (value) => {
    const v = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem("muxics-volume", String(v));
    } catch {}
    set((s) => ({ player: { ...s.player, volume: v } }));
  },

  setPlaybackUrl: (url) =>
    set((s) => ({ player: { ...s.player, playbackUrl: url } })),

  toggleShuffle: () => {
    const { player } = get();
    const newShuffle = !player.shuffle;
    if (newShuffle) {
      const current = player.currentTrack;
      const rest = player.queue.filter((t) => t.id !== current?.id);
      const shuffled = current
        ? [current, ...shuffleArray(rest)]
        : shuffleArray(player.queue);
      set((s) => ({
        player: {
          ...s.player,
          shuffle: true,
          originalQueue: s.player.queue,
          queue: shuffled,
        },
      }));
    } else {
      set((s) => ({
        player: {
          ...s.player,
          shuffle: false,
          queue: s.player.originalQueue,
        },
      }));
    }
  },

  cycleRepeat: () => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const current = get().player.repeat;
    const idx = modes.indexOf(current);
    set((s) => ({
      player: { ...s.player, repeat: modes[(idx + 1) % modes.length] },
    }));
  },

  addToRecentlyPlayed: (track) => {
    set((s) => {
      const filtered = s.recentlyPlayed.filter((t) => t.id !== track.id);
      return {
        recentlyPlayed: [track, ...filtered].slice(0, MAX_RECENTLY_PLAYED),
      };
    });
  },

  updateQueue: (newQueue) => {
    set((s) => ({
      player: { ...s.player, queue: newQueue, originalQueue: newQueue },
    }));
  },

  playNext: (track) => {
    const { player } = get();
    const queue = [...player.queue];
    const idx = queue.findIndex((t) => t.id === player.currentTrack?.id);
    if (idx >= 0) {
      queue.splice(idx + 1, 0, track);
    } else {
      queue.unshift(track);
    }
    if (!player.currentTrack) {
      get().playTrack(track, queue);
    } else {
      set((s) => ({ player: { ...s.player, queue, originalQueue: queue } }));
    }
  },

  addToQueue: (track) => {
    const { player } = get();
    const queue = [...player.queue, track];
    if (!player.currentTrack) {
      get().playTrack(track, queue);
    } else {
      set((s) => ({ player: { ...s.player, queue, originalQueue: queue } }));
    }
  },

  setInitReady: () => set({ _initReady: true }),
  setInitStatus: (status) => set({ _initStatus: status }),
}));
