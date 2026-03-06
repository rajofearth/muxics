import type { RepeatMode, Track } from "../types";

type NextTrackParams = {
  queue: Track[];
  currentTrack: Track | null;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  manual?: boolean;
};

export function getTrackIndex(queue: Track[], currentTrack: Track | null): number {
  if (!currentTrack) {
    return -1;
  }

  return queue.findIndex((track) => track.path === currentTrack.path);
}

export function mapTrackPaths(trackPaths: string[], tracks: Track[]): Track[] {
  const trackMap = new Map(tracks.map((track) => [track.path, track]));
  return trackPaths.map((trackPath) => trackMap.get(trackPath)).filter((track): track is Track => !!track);
}

export function resolveNextTrack({
  queue,
  currentTrack,
  shuffleEnabled,
  repeatMode,
  manual = false,
}: NextTrackParams): Track | null {
  if (queue.length === 0) {
    return null;
  }

  if (!currentTrack) {
    return queue[0];
  }

  if (!manual && repeatMode === "one") {
    return currentTrack;
  }

  if (shuffleEnabled) {
    const candidates = queue.filter((track) => track.path !== currentTrack.path);
    if (candidates.length === 0) {
      return repeatMode === "off" ? null : currentTrack;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const currentIndex = getTrackIndex(queue, currentTrack);
  if (currentIndex === -1) {
    return queue[0];
  }

  if (currentIndex < queue.length - 1) {
    return queue[currentIndex + 1];
  }

  return repeatMode === "all" ? queue[0] : null;
}

export function resolvePreviousTrack(queue: Track[], currentTrack: Track | null): Track | null {
  if (queue.length === 0) {
    return null;
  }

  if (!currentTrack) {
    return queue[0];
  }

  const currentIndex = getTrackIndex(queue, currentTrack);
  if (currentIndex <= 0) {
    return null;
  }

  return queue[currentIndex - 1];
}
