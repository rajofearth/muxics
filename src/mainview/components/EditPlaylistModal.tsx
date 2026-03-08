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
    <Dialog title="Rename Playlist" onClose={onClose} maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          className="w-full px-3 py-2.5 bg-app-elevated border border-app-border rounded-lg text-[13px] text-app-text-primary placeholder-app-text-tertiary mb-4 focus:border-app-text-tertiary outline-none"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-app-text-secondary hover:text-app-text-primary rounded-lg hover:bg-app-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-2 text-[13px] font-medium bg-app-text-primary text-app-bg rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
