import { useState, useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { Playlist } from "../types";
import { Dialog } from "./Dialog";

type EditPlaylistModalProps = {
  playlist: Playlist;
  onClose: () => void;
};

export function EditPlaylistModal({ playlist, onClose }: EditPlaylistModalProps) {
  const [name, setName] = useState(playlist.name.replace(/\.m3u8?$/i, ""));
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);

  useEffect(() => {
    setName(playlist.name.replace(/\.m3u8?$/i, ""));
  }, [playlist]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name === playlist.name.replace(/\.m3u8?$/i, "")) {
      onClose();
      return;
    }
    await renamePlaylist(playlist.id, name.trim());
    onClose();
  };

  return (
    <Dialog title="RENAME PLAYLIST" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          className="mb-4 w-full rounded-full border border-white/10 bg-white/4 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-sky-300/40"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-white/45 transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-full bg-white px-4 py-2 text-slate-950 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
