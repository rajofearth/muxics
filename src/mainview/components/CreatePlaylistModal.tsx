import { useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { Dialog } from "./Dialog";

type CreatePlaylistModalProps = {
  onClose: () => void;
};

export function CreatePlaylistModal({ onClose }: CreatePlaylistModalProps) {
  const [name, setName] = useState("");
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist(name.trim());
    onClose();
  };

  return (
    <Dialog title="CREATE PLAYLIST" onClose={onClose}>
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
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
