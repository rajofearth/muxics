import { memo } from "react";
import { ListMusic, Play, Search, Shuffle } from "lucide-react";
import type { NavView, Playlist, Track } from "../types";
import { TrackTable } from "./TrackTable";
import { formatTotalDuration, playlistVisibleTrackCount, shuffleArray } from "../utils";

type YtMusicHomeViewProps = {
  tracks: Track[];
  playlists: Playlist[];
  recentlyPlayed: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  loading: boolean;
  error: string | null;
  profileName?: string;
  onNavigate: (view: NavView, id?: string) => void;
  onPlayTrack: (track: Track, queue: Track[] | null) => void;
};

function playQueue(queue: Track[], onPlayTrack: (track: Track, queue: Track[] | null) => void) {
  if (queue.length > 0) {
    onPlayTrack(queue[0], queue);
  }
}

function shuffleQueue(queue: Track[], onPlayTrack: (track: Track, queue: Track[] | null) => void) {
  if (queue.length > 0) {
    const shuffled = shuffleArray(queue);
    onPlayTrack(shuffled[0], shuffled);
  }
}

export const YtMusicHomeView = memo(function YtMusicHomeView({
  tracks,
  playlists,
  recentlyPlayed,
  currentTrack,
  isPlaying,
  loading,
  error,
  profileName,
  onNavigate,
  onPlayTrack,
}: YtMusicHomeViewProps) {
  const resumeTracks = recentlyPlayed.length > 0 ? recentlyPlayed : tracks;
  const featuredTracks = tracks.slice(0, 12);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl border border-app-border bg-app-surface-alt/80 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.28em] text-app-text-tertiary">
                YouTube Music
              </div>
              <h1 className="mt-2 text-[28px] font-semibold text-app-text-primary">
                {profileName ?? "Your library"}
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-app-text-secondary">
                Fast access to recent songs, playlists, and the tracks you are most likely to play next.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:w-[320px]">
              <div className="rounded-2xl border border-app-border bg-app-elevated px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-app-text-tertiary">Songs</div>
                <div className="mt-1 text-[15px] font-medium text-app-text-primary">{tracks.length}</div>
              </div>
              <div className="rounded-2xl border border-app-border bg-app-elevated px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-app-text-tertiary">Playlists</div>
                <div className="mt-1 text-[15px] font-medium text-app-text-primary">{playlists.length}</div>
              </div>
              <div className="rounded-2xl border border-app-border bg-app-elevated px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-app-text-tertiary">Length</div>
                <div className="mt-1 text-[15px] font-medium text-app-text-primary">{formatTotalDuration(tracks)}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => playQueue(resumeTracks, onPlayTrack)}
              disabled={resumeTracks.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg disabled:opacity-50"
            >
              <Play size={14} className="fill-current" />
              Play recent
            </button>
            <button
              type="button"
              onClick={() => shuffleQueue(tracks, onPlayTrack)}
              disabled={tracks.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary disabled:opacity-50"
            >
              <Shuffle size={14} />
              Shuffle songs
            </button>
            <button
              type="button"
              onClick={() => onNavigate("search")}
              className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary"
            >
              <Search size={14} />
              Search
            </button>
            <button
              type="button"
              onClick={() => onNavigate("playlists")}
              className="inline-flex items-center gap-2 rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary"
            >
              <ListMusic size={14} />
              Open playlists
            </button>
          </div>
        </section>

        {error && !loading ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
            {error}
          </div>
        ) : null}

        {loading && tracks.length === 0 ? (
          <div className="rounded-2xl border border-app-border bg-app-surface-alt/70 px-4 py-6 text-center text-[13px] text-app-text-tertiary">
            Loading your YouTube Music library...
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-app-border bg-app-surface-alt/75 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-app-text-tertiary">Continue</div>
                <h2 className="mt-1 text-[18px] font-semibold text-app-text-primary">Recently played</h2>
              </div>
              <div className="text-[12px] text-app-text-tertiary">{resumeTracks.length} tracks</div>
            </div>
            <TrackTable
              tracks={resumeTracks.slice(0, 10)}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onTrackClick={onPlayTrack}
              compact
              sortable={false}
            />
          </div>

          <div className="rounded-3xl border border-app-border bg-app-surface-alt/75 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-app-text-tertiary">Playlists</div>
                <h2 className="mt-1 text-[18px] font-semibold text-app-text-primary">Open a playlist</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("playlists")}
                className="text-[12px] text-app-text-secondary hover:text-app-text-primary"
              >
                View all
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {playlists.slice(0, 8).map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onNavigate("playlist_detail", playlist.id)}
                  className="w-full rounded-2xl border border-app-border bg-app-elevated px-4 py-3 text-left hover:bg-app-active"
                >
                  <div className="text-[13px] font-medium text-app-text-primary truncate">{playlist.name}</div>
                  <div className="mt-1 text-[12px] text-app-text-tertiary">
                    {playlistVisibleTrackCount(playlist)} songs
                  </div>
                </button>
              ))}
              {playlists.length === 0 ? (
                <div className="rounded-2xl border border-app-border bg-app-elevated px-4 py-4 text-[12px] text-app-text-tertiary">
                  No playlists found yet.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-app-border bg-app-surface-alt/75 overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-app-text-tertiary">Top songs</div>
              <h2 className="mt-1 text-[18px] font-semibold text-app-text-primary">Ready to play</h2>
            </div>
            <div className="text-[12px] text-app-text-tertiary">{featuredTracks.length} tracks</div>
          </div>
          <TrackTable
            tracks={featuredTracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onTrackClick={onPlayTrack}
            compact
            sortable={false}
          />
        </section>
      </div>
    </div>
  );
});
