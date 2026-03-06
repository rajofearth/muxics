import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { TrackRow } from "./TrackRow";

type TrackTableProps = {
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  likedTrackPaths?: string[];
  playlistId?: string;
  queueMode?: boolean;
  showArtistColumn?: boolean;
  showAlbumColumn?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onTrackClick: (track: Track, queue: Track[]) => void;
};

export function TrackTable({
  tracks,
  currentTrack,
  isPlaying,
  likedTrackPaths = [],
  playlistId,
  queueMode = false,
  showArtistColumn = true,
  showAlbumColumn = true,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Try another filter or add more music to your library.",
  onTrackClick,
}: TrackTableProps) {
  const toggleLikedTrack = usePlayerStore((state) => state.toggleLikedTrack);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[rgba(12,18,28,0.82)] shadow-[0_20px_70px_rgba(3,8,18,0.38)] backdrop-blur-xl">
        <div className="sticky top-0 z-10 grid grid-cols-[52px_minmax(0,1.6fr)_minmax(0,1.1fr)_96px_42px] gap-4 border-b border-white/8 bg-[rgba(8,13,22,0.88)] px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-white/40 backdrop-blur-xl">
          <div>#</div>
          <div>Track</div>
          <div>{showAlbumColumn ? "Album" : showArtistColumn ? "Artist" : "Collection"}</div>
          <div className="text-right">Time</div>
          <div />
        </div>

        <div className="divide-y divide-white/6">
          {tracks.map((track, i) => (
            <TrackRow
              key={`${track.id}-${i}`}
              track={track}
              index={i}
              isActive={track.id === currentTrack?.id}
              isPlaying={isPlaying}
              isLiked={likedTrackPaths.includes(track.path)}
              playlistId={playlistId}
              queueIndex={queueMode ? i : undefined}
              showArtist={showArtistColumn}
              showAlbum={showAlbumColumn}
              onToggleLike={() => toggleLikedTrack(track)}
              onClick={() => onTrackClick(track, tracks)}
            />
          ))}
          {tracks.length === 0 && (
            <div className="px-6 py-16 text-center">
              <div className="mb-2 text-base font-medium text-white/78">{emptyTitle}</div>
              <div className="text-sm text-white/45">{emptyDescription}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
