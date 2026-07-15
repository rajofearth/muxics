import type { LibrarySource, Playlist, Track } from "../types";
import type { PlaylistResult, TrackResult } from "../../shared/desktop-contract";

export function toTrack(track: TrackResult): Track {
  return {
    id: track.id,
    provider: track.provider,
    providerId: track.providerId,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    time: track.time,
    duration: track.duration,
    genre: track.genre,
    picture: track.picture,
    sourceLabel: track.sourceLabel,
    playback: track.playback,
    liked: track.liked,
  };
}

export function toPlaylist(playlist: PlaylistResult): Playlist {
  const trackIdsFromEntries = playlist.entries.map((entry) => entry.id);
  const trackIdsFromTracks = (playlist.tracks ?? []).map((t) => t.id);
  const trackIds =
    trackIdsFromEntries.length > 0 ? trackIdsFromEntries : trackIdsFromTracks;

  return {
    id: playlist.id,
    provider: playlist.provider,
    providerId: playlist.providerId,
    name: playlist.name,
    path: playlist.path,
    trackIds,
    editable: playlist.editable,
    tracks: playlist.tracks?.map(toTrack),
    listedItemCount: playlist.listedItemCount,
    author: playlist.author,
    picture: playlist.picture,
    type: playlist.type,
  };
}

export function mergeTracks(
  source: LibrarySource,
  localTracks: Track[],
  remoteTracks: Track[],
): Track[] {
  if (source === "local") {
    return localTracks;
  }

  if (source === "ytmusic") {
    return remoteTracks;
  }

  return [...remoteTracks, ...localTracks];
}

export function mergeUniqueTracks(...groups: Track[][]): Track[] {
  const byId = new Map<string, Track>();
  for (const group of groups) {
    for (const track of group) {
      byId.set(track.id, track);
    }
  }
  return [...byId.values()];
}

export async function pLimit<T, R>(
  items: T[],
  fn: (x: T) => Promise<R>,
  concurrency = 10,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const res = await fn(items[i]);
      results[i] = res;
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export function mergePlaylists(
  source: LibrarySource,
  localItems: Playlist[],
  remoteItems: Playlist[],
  transientItems: Playlist[] = [],
): Playlist[] {
  const base =
    source === "local"
      ? localItems
      : source === "ytmusic"
        ? remoteItems
        : [...remoteItems, ...localItems];

  // Include transient items (browsed from home/search but not in library)
  // that are not already in the library base
  const libraryIds = new Set(base.map((p) => p.id));
  const uniqueTransient = transientItems.filter((p) => !libraryIds.has(p.id));

  return [...base, ...uniqueTransient];
}
