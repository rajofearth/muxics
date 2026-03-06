import { useMemo, useRef, useEffect } from "react";
import { ListMusic, Music } from "lucide-react";
import type { Track } from "../types";
import { TrackRow } from "./TrackRow";
import { formatTotalDuration } from "../utils";

type QueueViewProps = {
  queue: Track[];
  currentTrack: Track | null;
  onPlayTrack: (track: Track, queue: Track[]) => void;
};

export function QueueView({ queue, currentTrack, onPlayTrack }: QueueViewProps) {
  const currentIdx = useMemo(
    () => queue.findIndex((t) => t.id === currentTrack?.id),
    [queue, currentTrack]
  );

  const upNext = useMemo(
    () => (currentIdx >= 0 ? queue.slice(currentIdx + 1) : queue),
    [queue, currentIdx]
  );

  const nowPlayingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nowPlayingRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentTrack?.id]);

  if (queue.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-app-text-tertiary">
        <ListMusic size={48} strokeWidth={1} className="opacity-40" />
        <div className="text-sm">Your queue is empty</div>
        <div className="text-xs">Play a song to get started</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h1 className="text-2xl font-bold text-app-text-primary tracking-tight">Up Next</h1>
        <p className="text-[13px] text-app-text-tertiary mt-1">
          {queue.length} songs · {formatTotalDuration(queue)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {currentTrack && (
          <div ref={nowPlayingRef} className="px-6 pb-3 shrink-0">
            <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider px-2 py-1.5">
              Now Playing
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-app-active">
              {currentTrack.picture ? (
                <img src={currentTrack.picture} alt="" className="w-12 h-12 rounded-md object-cover shadow-sm" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-app-elevated flex items-center justify-center">
                  <Music size={20} className="text-app-text-tertiary" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-app-accent truncate">{currentTrack.title}</div>
                <div className="text-[12px] text-app-text-tertiary truncate mt-0.5">
                  {currentTrack.artist}{currentTrack.album ? ` · ${currentTrack.album}` : ""}
                </div>
              </div>
              <div className="text-[12px] text-app-text-tertiary tabular-nums">{currentTrack.time}</div>
            </div>
          </div>
        )}

        {upNext.length > 0 && (
          <div>
            <div className="px-8 py-2">
              <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider">
                Next ({upNext.length})
              </div>
            </div>
            <div className="pb-4">
              {upNext.map((track, i) => (
                <TrackRow
                  key={`${track.id}-queue-${currentIdx + 1 + i}`}
                  track={track}
                  index={currentIdx + 1 + i}
                  isActive={false}
                  isPlaying={false}
                  onClick={() => onPlayTrack(track, queue)}
                  compact
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
