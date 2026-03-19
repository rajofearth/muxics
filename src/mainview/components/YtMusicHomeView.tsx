import { memo, type ReactNode } from "react";
import { ArrowRight, Play, Shuffle, Search, Sparkles } from "lucide-react";
import type { NavView, Playlist, Track } from "../types";
import { TrackTable } from "./TrackTable";
import { formatTotalDuration, shuffleArray } from "../utils";

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

type ShelfCardProps = {
  item: Track;
  queue: Track[];
  onPlay: (track: Track, queue: Track[]) => void;
};

type PlaylistCardProps = {
  playlist: Playlist;
  index: number;
  onOpen: (playlist: Playlist) => void;
};

const PLAYLIST_GRADIENTS = [
  "from-orange-400/35 via-amber-500/20 to-transparent",
  "from-rose-400/35 via-red-500/20 to-transparent",
  "from-cyan-400/35 via-sky-500/20 to-transparent",
  "from-lime-400/35 via-emerald-500/20 to-transparent",
];

function formatGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ShelfCard({ item, queue, onPlay }: ShelfCardProps) {
  return (
    <button
      type="button"
      onClick={() => onPlay(item, queue)}
      className="group min-w-48 max-w-48 text-left rounded-2xl border border-app-border bg-app-elevated/70 overflow-hidden shadow-sm hover:bg-app-active transition-colors"
    >
      <div className="relative aspect-square overflow-hidden">
        {item.picture ? (
          <img src={item.picture} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-app-elevated via-app-surface to-app-active" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="absolute bottom-3 right-3 h-10 w-10 rounded-full bg-app-text-primary text-app-bg flex items-center justify-center opacity-0 translate-y-2 transition-all group-hover:opacity-100 group-hover:translate-y-0">
          <Play size={16} className="fill-current ml-0.5" />
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-[13px] font-medium text-app-text-primary">{item.title}</div>
        <div className="truncate text-[12px] text-app-text-tertiary">{item.artist}</div>
      </div>
    </button>
  );
}

function PlaylistCard({ playlist, index, onOpen }: PlaylistCardProps) {
  const gradient = PLAYLIST_GRADIENTS[index % PLAYLIST_GRADIENTS.length];

  return (
    <button
      type="button"
      onClick={() => onOpen(playlist)}
      className="group min-w-56 max-w-56 text-left rounded-2xl border border-app-border bg-app-elevated/70 overflow-hidden shadow-sm hover:bg-app-active transition-colors"
    >
      <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${gradient}`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.18),_transparent_45%)]" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="text-[12px] font-medium text-white/90 truncate">{playlist.name}</div>
          <div className="text-[11px] text-white/70 mt-0.5">{playlist.trackIds.length} songs</div>
        </div>
      </div>
    </button>
  );
}

function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-app-text-tertiary">
          {subtitle}
        </div>
        <h2 className="mt-1 text-[18px] font-semibold text-app-text-primary">{title}</h2>
      </div>
      {action}
    </div>
  );
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
  const playableTracks = tracks.length > 0 ? tracks : recentlyPlayed;
  const resumeTracks = recentlyPlayed.length > 0 ? recentlyPlayed : playableTracks;

  const playAll = (queue: Track[]) => {
    if (queue.length > 0) {
      onPlayTrack(queue[0], queue);
    }
  };

  const shufflePlay = (queue: Track[]) => {
    if (queue.length > 0) {
      const shuffled = shuffleArray(queue);
      onPlayTrack(shuffled[0], shuffled);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 pt-6 pb-7">
        <div className="rounded-[28px] border border-app-border bg-app-surface-alt/80 px-6 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
          <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-elevated px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-app-text-tertiary">
                <Sparkles size={12} />
                YouTube Music
              </div>
              <h1 className="mt-3 text-[32px] font-semibold tracking-tight text-app-text-primary">
                {formatGreeting()}, {profileName ?? "listener"}
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-app-text-secondary">
                Jump back into playlists, start listening quickly, or open search without leaving your library.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:max-w-lg">
              <div className="rounded-2xl border border-app-border bg-app-elevated px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-app-text-tertiary">Songs</div>
                <div className="mt-1 text-[14px] font-medium text-app-text-primary">{tracks.length}</div>
              </div>
              <div className="rounded-2xl border border-app-border bg-app-elevated px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-app-text-tertiary">Playlists</div>
                <div className="mt-1 text-[14px] font-medium text-app-text-primary">{playlists.length}</div>
              </div>
              <div className="rounded-2xl border border-app-border bg-app-elevated px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-app-text-tertiary">Duration</div>
                <div className="mt-1 text-[14px] font-medium text-app-text-primary">{formatTotalDuration(tracks)}</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playAll(playableTracks)}
              disabled={playableTracks.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={14} className="fill-current" />
              Play all
            </button>
            <button
              type="button"
              onClick={() => shufflePlay(playableTracks)}
              disabled={playableTracks.length === 0}
              className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary transition-colors hover:bg-app-active disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shuffle size={14} />
              Shuffle
            </button>
            <button
              type="button"
              onClick={() => onNavigate("search")}
              className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary transition-colors hover:bg-app-active"
            >
              <Search size={14} />
              Search
            </button>
            <button
              type="button"
              onClick={() => onNavigate("playlists")}
              className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-elevated px-4 py-2 text-[13px] font-medium text-app-text-primary transition-colors hover:bg-app-active"
            >
              <ArrowRight size={14} />
              Open playlists
            </button>
          </div>
        </div>
        </div>
      </div>

      <div className="space-y-8 px-8 pb-8">
        {loading && playableTracks.length === 0 ? (
          <div className="rounded-3xl border border-app-border bg-app-surface-alt/60 px-6 py-10 text-center text-app-text-tertiary">
            Loading your YouTube Music home...
          </div>
        ) : null}

        {error && playableTracks.length === 0 ? (
          <div className="rounded-3xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-[13px] text-red-200">
            {error}
          </div>
        ) : null}

        {!loading && !error && tracks.length === 0 && playlists.length > 0 ? (
          <div className="rounded-3xl border border-app-border bg-app-surface-alt/70 px-6 py-5 text-center">
            <div className="text-[15px] font-medium text-app-text-primary">
              Your playlists are loaded, but songs could not be extracted yet
            </div>
            <div className="mt-2 text-[13px] text-app-text-tertiary">
              You can still open your playlists while we tighten the song sync path.
            </div>
          </div>
        ) : null}

        {!loading && !error && tracks.length === 0 && playlists.length === 0 ? (
          <div className="rounded-3xl border border-app-border bg-app-surface-alt/70 px-6 py-5 text-center">
            <div className="text-[15px] font-medium text-app-text-primary">
              No YouTube Music songs found yet
            </div>
            <div className="mt-2 text-[13px] text-app-text-tertiary">
              Sync again after opening your library in YouTube Music if this account already has saved songs.
            </div>
          </div>
        ) : null}

        {resumeTracks.length > 0 ? (
          <section className="space-y-3">
            <SectionHeading
              title="Continue listening"
              subtitle="Resume"
              action={(
                <button
                  type="button"
                  onClick={() => playAll(resumeTracks)}
                  className="text-[12px] font-medium text-app-text-secondary hover:text-app-text-primary"
                >
                  Play all
                </button>
              )}
            />
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
              {resumeTracks.slice(0, 10).map((track) => (
                <ShelfCard key={track.id} item={track} queue={resumeTracks} onPlay={onPlayTrack} />
              ))}
            </div>
          </section>
        ) : null}

        {playableTracks.length > 0 ? (
          <section className="space-y-3">
            <SectionHeading title="Your picks" subtitle="Songs" />
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
              {playableTracks.slice(0, 12).map((track) => (
                <ShelfCard key={track.id} item={track} queue={playableTracks} onPlay={onPlayTrack} />
              ))}
            </div>
          </section>
        ) : null}

        {playlists.length > 0 ? (
          <section className="space-y-3">
            <SectionHeading title="Your playlists" subtitle="Library" />
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
              {playlists.slice(0, 8).map((playlist, index) => (
                <PlaylistCard
                  key={playlist.id}
                  playlist={playlist}
                  index={index}
                  onOpen={(item) => onNavigate("playlist_detail", item.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[28px] border border-app-border bg-app-surface-alt/75 shadow-[0_24px_80px_rgba(0,0,0,0.28)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-6 pt-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-app-text-tertiary">
                Up next
              </div>
              <h2 className="mt-1 text-[18px] font-semibold text-app-text-primary">Top songs</h2>
            </div>
            <div className="text-[12px] text-app-text-tertiary">
              {playableTracks.length} songs ready to play
            </div>
          </div>
          <div className="pt-3">
            <TrackTable
              tracks={playableTracks}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onTrackClick={onPlayTrack}
              compact
              sortable={false}
            />
          </div>
        </section>
      </div>
    </div>
  );
});
