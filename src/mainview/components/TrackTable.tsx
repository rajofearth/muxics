import { memo, useMemo, useState, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { Track } from "../types";
import { TrackRow } from "./TrackRow";
import { parseTime } from "../utils";

type SortKey = "title" | "artist" | "album" | "time";
type SortDir = "asc" | "desc";

type TrackTableProps = {
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onTrackClick: (track: Track, queue: Track[]) => void;
  compact?: boolean;
  sortable?: boolean;
  playlistId?: string;
};

function compareStrings(a: string, b: string, dir: SortDir): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

export const TrackTable = memo(function TrackTable({
  tracks,
  currentTrack,
  isPlaying,
  onTrackClick,
  compact = false,
  sortable = true,
  playlistId,
}: TrackTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        if (sortDir === "asc") setSortDir("desc");
        else { setSortKey(null); setSortDir("asc"); }
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir]
  );

  const sortedTracks = useMemo(() => {
    if (!sortKey) return tracks;
    return [...tracks].sort((a, b) => {
      switch (sortKey) {
        case "title": return compareStrings(a.title, b.title, sortDir);
        case "artist": return compareStrings(a.artist, b.artist, sortDir);
        case "album": return compareStrings(a.album, b.album, sortDir);
        case "time": {
          const diff = parseTime(a.time) - parseTime(b.time);
          return sortDir === "asc" ? diff : -diff;
        }
        default: return 0;
      }
    });
  }, [tracks, sortKey, sortDir]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ChevronUp size={12} className="inline ml-0.5" />
    ) : (
      <ChevronDown size={12} className="inline ml-0.5" />
    );
  };

  const headerButton = (key: SortKey, label: string, className: string) =>
    sortable ? (
      <button
        onClick={() => handleSort(key)}
        className={`${className} hover:text-app-text-secondary cursor-pointer select-none ${sortKey === key ? "text-app-text-secondary" : ""}`}
      >
        {label}
        <SortIcon column={key} />
      </button>
    ) : (
      <div className={className}>{label}</div>
    );

  const header = !compact ? (
    <div className="sticky top-0 bg-app-bg/95 backdrop-blur-sm z-10 flex items-center px-6 py-2 mx-2 text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider border-b border-app-border">
      <div className="w-8 shrink-0">#</div>
      {headerButton("title", "Title", "flex-1 ml-2 text-left")}
      {headerButton("artist", "Artist", "w-[22%] px-2 hidden md:block text-left")}
      {headerButton("album", "Album", "w-[22%] px-2 hidden lg:block text-left")}
      {headerButton("time", "Time", "w-12 text-right shrink-0")}
    </div>
  ) : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {header}
      <div className="py-1">
        {sortedTracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            isActive={track.id === currentTrack?.id}
            isPlaying={isPlaying}
            onClick={() => onTrackClick(track, sortedTracks)}
            compact={compact}
            playlistId={playlistId}
          />
        ))}
        {sortedTracks.length === 0 && (
          <div className="px-8 py-16 text-center text-app-text-tertiary text-sm">
            No tracks found
          </div>
        )}
      </div>
    </div>
  );
});
