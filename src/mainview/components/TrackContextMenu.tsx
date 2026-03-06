import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Check, Trash2, LayoutList, ListMusic } from "lucide-react";
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";

type TrackContextMenuProps = {
  x: number;
  y: number;
  track: Track;
  onClose: () => void;
  playlistId?: string;
};

export function TrackContextMenu({ x, y, track, onClose, playlistId }: TrackContextMenuProps) {
  const { playlists, addTrackToPlaylist, removeTrackFromPlaylist, playTrack, player } = usePlayerStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [showPlaylists, setShowPlaylists] = useState(false);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let adjX = x, adjY = y;
    if (x + rect.width > vw) adjX = vw - rect.width - 8;
    if (y + rect.height > vh) adjY = vh - rect.height - 8;
    if (adjX !== x || adjY !== y) setPosition({ x: adjX, y: adjY });
  }, [x, y]);

  const handlePlayNext = () => {
    const queue = [...player.queue];
    const idx = queue.findIndex((t) => t.id === player.currentTrack?.id);
    if (idx >= 0) {
      queue.splice(idx + 1, 0, track);
    } else {
      queue.push(track);
    }
    if (player.currentTrack) {
      playTrack(player.currentTrack, queue);
    }
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-app-surface border border-app-border shadow-2xl rounded-xl py-1 min-w-[200px] animate-fade-in backdrop-blur-xl"
      style={{ left: position.x, top: position.y }}
    >
      <button
        onClick={handlePlayNext}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-app-text-primary hover:bg-app-hover rounded-md"
      >
        <LayoutList size={14} className="text-app-text-tertiary" />
        Play Next
      </button>

      <div className="h-px bg-app-border mx-2 my-1" />

      <button
        onClick={() => setShowPlaylists(!showPlaylists)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-app-text-primary hover:bg-app-hover rounded-md"
      >
        <ListMusic size={14} className="text-app-text-tertiary" />
        <span className="flex-1">Add to Playlist</span>
        <span className="text-app-text-tertiary text-[11px]">{showPlaylists ? "▾" : "▸"}</span>
      </button>

      {showPlaylists && (
        <div className="ml-2 border-l border-app-border">
          {playlists.items.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-app-text-tertiary ml-2">No playlists</div>
          ) : (
            playlists.items.map((pl) => {
              const isInPlaylist = pl.trackIds.includes(track.path);
              return (
                <button
                  key={pl.id}
                  onClick={async () => {
                    if (!isInPlaylist) await addTrackToPlaylist(pl.id, track);
                    onClose();
                  }}
                  disabled={isInPlaylist}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left ml-2 ${
                    isInPlaylist
                      ? "text-app-text-tertiary cursor-default"
                      : "text-app-text-secondary hover:bg-app-hover hover:text-app-text-primary"
                  }`}
                >
                  {isInPlaylist ? (
                    <Check size={12} className="text-app-accent shrink-0" />
                  ) : (
                    <Plus size={12} className="shrink-0 text-app-text-tertiary" />
                  )}
                  <span className="truncate">{pl.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {playlistId && (
        <>
          <div className="h-px bg-app-border mx-2 my-1" />
          <button
            onClick={async () => {
              await removeTrackFromPlaylist(playlistId, track.path);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-red-400 hover:bg-red-500/10 rounded-md"
          >
            <Trash2 size={14} />
            Remove from Playlist
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
