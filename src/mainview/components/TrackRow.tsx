import { useState } from "react";
import { Heart, Music2, Volume2 } from "lucide-react";
import type { Track } from "../types";
import { TrackContextMenu } from "./TrackContextMenu";

type TrackRowProps = {
  track: Track;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  playlistId?: string;
  queueIndex?: number;
  showArtist?: boolean;
  showAlbum?: boolean;
  onToggleLike: () => void;
  onClick: () => void;
};

export function TrackRow({
  track,
  index,
  isActive,
  isPlaying,
  isLiked,
  playlistId,
  queueIndex,
  showArtist = true,
  showAlbum = true,
  onToggleLike,
  onClick,
}: TrackRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`group grid grid-cols-[52px_minmax(0,1.6fr)_minmax(0,1.1fr)_96px_42px] items-center gap-4 px-5 py-3 text-sm transition ${
          isActive
            ? "bg-white/8 text-white"
            : "text-white/72 hover:bg-white/5 hover:text-white"
        }`}
      >
        <div className="flex items-center justify-center text-xs text-white/35">
          {isActive ? (
            <Volume2 size={14} className={isPlaying ? "animate-pulse text-sky-300" : "text-sky-200"} />
          ) : (
            (index + 1).toString().padStart(2, "0")
          )}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/6">
            {track.picture ? (
              <img src={track.picture} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 size={16} className="text-white/35" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{track.title}</div>
            <div className="truncate text-xs text-white/45">{track.artist}</div>
          </div>
        </div>
        <div className="min-w-0">
          {showAlbum && <div className="truncate">{track.album}</div>}
          {!showAlbum && showArtist && <div className="truncate">{track.artist}</div>}
          {showAlbum && showArtist && <div className="truncate text-xs text-white/45">{track.genre}</div>}
        </div>
        <div className="text-right text-xs text-white/45">{track.time}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleLike();
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/35 transition hover:bg-white/8 hover:text-rose-300"
          aria-label={isLiked ? "Remove from favorites" : "Add to favorites"}
        >
          <Heart size={15} className={isLiked ? "fill-rose-400 text-rose-400" : ""} />
        </button>
      </div>
      {contextMenu && (
        <TrackContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={track}
          playlistId={playlistId}
          queueIndex={queueIndex}
          onClose={() => setContextMenu(null)}
        />
      )}
      {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} aria-hidden />}
    </>
  );
}
