import { memo, useState, useCallback } from "react";
import { Play, Heart } from "lucide-react";
import type { Track } from "../types";
import { useUiStore } from "../store/uiStore";
import { TrackContextMenu } from "./TrackContextMenu";
import { EqBars } from "./EqBars";
import { showToast } from "./Toast";

type TrackRowProps = {
  track: Track;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onClick: () => void;
  compact?: boolean;
  playlistId?: string;
};

export const TrackRow = memo(function TrackRow({
  track,
  index,
  isActive,
  isPlaying,
  onClick,
  compact = false,
  playlistId,
}: TrackRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const toggleFavorite = useUiStore((s) => s.toggleFavorite);
  const isFav = useUiStore((s) => s.favorites.has(track.id));

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(track.id);
    showToast(isFav ? "Removed from favorites" : "Added to favorites", "success", "favorite");
  }, [toggleFavorite, track.id, isFav]);

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={onContextMenu}
        role="row"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        className={`flex items-center ${compact ? "px-4 py-2" : "px-6 py-2.5"} text-[13px] group cursor-pointer rounded-lg mx-2 ${
          isActive ? "bg-app-active" : "hover:bg-app-hover"
        }`}
      >
        <div className="w-8 flex items-center justify-center shrink-0">
          {isActive ? (
            <EqBars playing={isPlaying} size={14} />
          ) : (
            <>
              <span className="text-app-text-tertiary text-xs group-hover:hidden tabular-nums">
                {index + 1}
              </span>
              <Play size={12} className="text-app-text-primary fill-current hidden group-hover:block" />
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-3 ml-2">
          {track.picture && !compact && (
            <img
              src={track.picture}
              alt=""
              className="w-9 h-9 rounded object-cover shrink-0"
              loading="lazy"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className={`truncate leading-tight ${isActive ? "text-app-accent font-medium" : "text-app-text-primary"}`}>
              {track.title}
            </div>
            {compact && (
              <div className="text-[11px] text-app-text-tertiary truncate leading-tight mt-0.5">
                {track.artist}
              </div>
            )}
          </div>
        </div>

        {!compact && (
          <>
            <div className="w-[22%] truncate text-app-text-secondary px-2 hidden md:block text-[12px]">
              {track.artist}
            </div>
            <div className="w-[22%] truncate text-app-text-tertiary px-2 hidden lg:block text-[12px]">
              {track.album}
            </div>
          </>
        )}

        <button
          onClick={handleFavorite}
          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFav}
          className={`w-6 flex items-center justify-center shrink-0 mr-1 ${
            isFav
              ? "text-app-accent"
              : "text-transparent group-hover:text-app-text-tertiary hover:!text-app-accent"
          }`}
        >
          <Heart size={12} className={isFav ? "fill-current" : ""} />
        </button>

        <div className="w-11 text-right text-app-text-tertiary text-[11px] tabular-nums shrink-0">
          {track.time}
        </div>
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} aria-hidden />
          <TrackContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            track={track}
            onClose={closeContextMenu}
            playlistId={playlistId}
          />
        </>
      )}
    </>
  );
});
