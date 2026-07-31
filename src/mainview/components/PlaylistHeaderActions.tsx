import { useState } from "react";
import { Pencil, Trash2, Bookmark, BookmarkPlus } from "lucide-react";
import { usePlaylistStore } from "../store/playlistStore";
import { useShallow } from "zustand/react/shallow";
import type { Playlist } from "../types";
import type { NavView } from "../types";
import { EditPlaylistModal } from "./EditPlaylistModal";
import { ConfirmDialog } from "./ConfirmDialog";

type PlaylistHeaderActionsProps = {
  playlist: Playlist;
  onNavigate: (view: NavView, id?: string) => void;
};

export function PlaylistHeaderActions({ playlist, onNavigate }: PlaylistHeaderActionsProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
  const { deletePlaylist, savePlaylistToLibrary, unsavePlaylistFromLibrary } = usePlaylistStore();
  const remoteItems = usePlaylistStore(useShallow((s) => s.playlists.remoteItems));
  
  const isYt = playlist.provider === "ytmusic";
  const isSaved = isYt && remoteItems.some(p => p.id === playlist.id);

  const handleDelete = async () => {
    await deletePlaylist(playlist.id);
    onNavigate("playlists");
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {isYt && (
          <button
            onClick={() => isSaved ? unsavePlaylistFromLibrary(playlist.id) : savePlaylistToLibrary(playlist.id)}
            className={`p-1.5 rounded-lg transition-colors ${
              isSaved 
                ? "text-app-accent hover:bg-app-accent/10" 
                : "text-app-text-tertiary hover:text-app-text-primary hover:bg-app-hover"
            }`}
            title={isSaved ? "Remove from Library" : "Save to Library"}
          >
            {isSaved ? <Bookmark size={18} fill="currentColor" /> : <BookmarkPlus size={18} />}
          </button>
        )}
        
        {playlist.editable && (
          <>
            <button
              onClick={() => setShowEditModal(true)}
              className="p-1.5 rounded-lg text-app-text-tertiary hover:text-app-text-primary hover:bg-app-hover"
              aria-label="Rename playlist"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="p-1.5 rounded-lg text-app-text-tertiary hover:text-red-400 hover:bg-red-500/10"
              aria-label="Delete playlist"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {showEditModal && (
        <EditPlaylistModal playlist={playlist} onClose={() => setShowEditModal(false)} />
      )}
      {showDeleteDialog && (
        <ConfirmDialog
          title="Delete Playlist"
          message={`Delete "${playlist.name}"? This won't remove the songs from your library.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  );
}
