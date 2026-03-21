import type { Playlist } from "./types";

/**
 * Returns the maximum track count hint for a playlist.
 * For partially-loaded remote playlists, the server-reported item count or
 * hydrated tracks length may be larger than the local trackIds array.
 */
export function playlistVisibleTrackCount(pl: Playlist): number {
  return Math.max(pl.trackIds.length, pl.listedItemCount ?? 0, pl.tracks?.length ?? 0);
}

export const parseTime = (timeStr: string): number => {
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
};

export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

export const formatTotalDuration = (tracks: { time: string }[]): string => {
  const totalSec = tracks.reduce((sum, t) => sum + parseTime(t.time), 0);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours} hr ${min} min`;
  return `${min} min`;
};

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
