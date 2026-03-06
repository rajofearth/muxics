import { createPortal } from "react-dom";
import { Check, Heart, ListPlus, Plus, Trash2, WandSparkles } from "lucide-react";
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";

type TrackContextMenuProps = {
  x: number;
  y: number;
  track: Track;
  playlistId?: string;
  queueIndex?: number;
  onClose: () => void;
};

export function TrackContextMenu({
  x,
  y,
  track,
  playlistId,
  queueIndex,
  onClose,
}: TrackContextMenuProps) {
  const {
    playlists,
    preferences,
    addTrackToPlaylist,
    addToQueueEnd,
    addToQueueNext,
    removeTrackFromPlaylist,
    removeFromQueueAt,
    toggleLikedTrack,
  } = usePlayerStore();
  const isLiked = preferences.likedTrackPaths.includes(track.path);

  return createPortal(
    <div
      className="fixed z-50 min-w-[240px] overflow-hidden rounded-2xl border border-white/10 bg-[rgba(12,18,28,0.96)] py-1.5 shadow-2xl backdrop-blur-xl"
      style={{ left: Math.min(x, window.innerWidth - 260), top: Math.min(y, window.innerHeight - 320) }}
    >
      <div className="px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
        Track actions
      </div>
      <button
        type="button"
        onClick={() => {
          addToQueueNext(track);
          onClose();
        }}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/6 hover:text-white"
      >
        <WandSparkles size={15} className="text-sky-300" />
        Play next
      </button>
      <button
        type="button"
        onClick={() => {
          addToQueueEnd(track);
          onClose();
        }}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/6 hover:text-white"
      >
        <ListPlus size={15} className="text-violet-300" />
        Add to queue
      </button>
      <button
        type="button"
        onClick={() => {
          toggleLikedTrack(track);
          onClose();
        }}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/6 hover:text-white"
      >
        <Heart size={15} className={isLiked ? "fill-rose-400 text-rose-400" : "text-rose-300"} />
        {isLiked ? "Remove from favorites" : "Add to favorites"}
      </button>

      {(playlistId || queueIndex !== undefined) && <div className="mx-4 my-1 h-px bg-white/8" />}

      {playlistId && (
        <button
          type="button"
          onClick={async () => {
            await removeTrackFromPlaylist(playlistId, track.path);
            onClose();
          }}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/6 hover:text-white"
        >
          <Trash2 size={15} className="text-amber-300" />
          Remove from playlist
        </button>
      )}

      {queueIndex !== undefined && (
        <button
          type="button"
          onClick={() => {
            removeFromQueueAt(queueIndex);
            onClose();
          }}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/6 hover:text-white"
        >
          <Trash2 size={15} className="text-orange-300" />
          Remove from queue
        </button>
      )}

      <div className="mx-4 my-1 h-px bg-white/8" />
      <div className="px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
        Add to playlist
      </div>
      {playlists.items.length === 0 ? (
        <div className="px-4 py-2.5 text-sm text-white/45">No playlists yet</div>
      ) : (
        playlists.items.map((playlist) => {
          const isInPlaylist = playlist.trackIds.includes(track.path);
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={async () => {
                if (!isInPlaylist) {
                  await addTrackToPlaylist(playlist.id, track);
                }
                onClose();
              }}
              disabled={isInPlaylist}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                isInPlaylist
                  ? "cursor-default text-white/40"
                  : "text-white/80 hover:bg-white/6 hover:text-white"
              }`}
            >
              {isInPlaylist ? (
                <Check size={15} className="shrink-0 text-emerald-300" />
              ) : (
                <Plus size={15} className="shrink-0 text-white/55" />
              )}
              <span className="truncate">{playlist.name}</span>
            </button>
          );
        })
      )}
    </div>,
    document.body
  );
}
