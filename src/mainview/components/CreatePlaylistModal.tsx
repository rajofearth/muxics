import { useState } from "react";
import { usePlaylistStore } from "../store/playlistStore";
import { Dialog } from "./Dialog";

type CreatePlaylistModalProps = {
  onClose: () => void;
};

export function CreatePlaylistModal({ onClose }: CreatePlaylistModalProps) {
  const [name, setName] = useState("");
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist(name.trim());
    onClose();
  };

  return (
    <Dialog title="New Playlist" onClose={onClose} maxWidth="sm">
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
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
