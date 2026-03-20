import { memo, useMemo, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

/** Estimated row height (px) — keep in sync with TrackRow padding + thumb */
const ROW_HEIGHT_COMPACT = 52;
const ROW_HEIGHT_FULL = 62;
/** Below this count, render all rows (avoids virtualizer overhead for tiny lists). */
const VIRTUALIZE_THRESHOLD = 32;

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
  const parentRef = useRef<HTMLDivElement>(null);

  const sortedTracks = useMemo(() => {
    if (!sortKey) return tracks;
    if (sortKey === "time") {
      const decorated = tracks.map((t) => ({ t, sec: parseTime(t.time) }));
      decorated.sort((a, b) => {
        const diff = a.sec - b.sec;
        return sortDir === "asc" ? diff : -diff;
      });
      return decorated.map((d) => d.t);
    }
    return [...tracks].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return compareStrings(a.title, b.title, sortDir);
        case "artist":
          return compareStrings(a.artist, b.artist, sortDir);
        case "album":
          return compareStrings(a.album, b.album, sortDir);
        default:
          return 0;
      }
    });
  }, [tracks, sortKey, sortDir]);

  const sortedRef = useRef(sortedTracks);
  sortedRef.current = sortedTracks;
  const onTrackClickRef = useRef(onTrackClick);
  onTrackClickRef.current = onTrackClick;

  const handleRowActivate = useCallback((trackId: string) => {
    const list = sortedRef.current;
    const track = list.find((t) => t.id === trackId);
    if (track) {
      onTrackClickRef.current(track, list);
    }
  }, []);

  const rowHeight = compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_FULL;
  const useVirtual = sortedTracks.length >= VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? sortedTracks.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        if (sortDir === "asc") setSortDir("desc");
        else {
          setSortKey(null);
          setSortDir("asc");
        }
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir],
  );

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
        type="button"
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
    <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0">
      {header}
      <div className="py-1 relative w-full">
        {sortedTracks.length === 0 ? (
          <div className="px-8 py-16 text-center text-app-text-tertiary text-sm">
            No tracks found
          </div>
        ) : useVirtual ? (
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const track = sortedTracks[vi.index];
              return (
                <div
                  key={track.id}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <TrackRow
                    track={track}
                    index={vi.index}
                    isActive={track.id === currentTrack?.id}
                    isPlaying={isPlaying}
                    onClick={() => handleRowActivate(track.id)}
                    compact={compact}
                    playlistId={playlistId}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          sortedTracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              isActive={track.id === currentTrack?.id}
              isPlaying={isPlaying}
              onClick={() => handleRowActivate(track.id)}
              compact={compact}
              playlistId={playlistId}
            />
          ))
        )}
      </div>
    </div>
  );
});
