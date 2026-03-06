import { useState } from "react";
import {
  Clock3,
  Disc3,
  FolderOpen,
  Heart,
  Home,
  ListMusic,
  Mic2,
  Music4,
  Plus,
} from "lucide-react";
import type { NavState, NavView } from "../types";
import type { Playlist } from "../types";
import { CreatePlaylistModal } from "./CreatePlaylistModal";

type SidebarProps = {
  navState: NavState;
  playlists: Playlist[];
  trackCount?: number;
  onNavigate: (view: NavView, id?: string) => void;
};

const NAV_ITEMS: { id: NavView; icon: typeof Home; label: string }[] = [
  { id: "home", icon: Home, label: "Home" },
  { id: "library", icon: Music4, label: "Songs" },
  { id: "artists", icon: Mic2, label: "Artists" },
  { id: "albums", icon: Disc3, label: "Albums" },
  { id: "favorites", icon: Heart, label: "Favorites" },
  { id: "recent", icon: Clock3, label: "Recently played" },
  { id: "queue", icon: ListMusic, label: "Queue" },
  { id: "playlists", icon: ListMusic, label: "Playlists" },
  { id: "folders", icon: FolderOpen, label: "Folders" },
];

export function Sidebar({ navState, playlists, trackCount = 0, onNavigate }: SidebarProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <aside className="hidden w-[284px] shrink-0 border-r border-white/8 bg-[rgba(10,15,24,0.72)] px-4 py-5 backdrop-blur-2xl lg:flex lg:flex-col">
      <div className="rounded-[28px] border border-white/8 bg-white/4 p-5 shadow-[0_24px_80px_rgba(2,6,16,0.32)]">
        <div className="mb-1 text-[11px] uppercase tracking-[0.24em] text-white/40">Library</div>
        <div className="text-2xl font-semibold text-white">Your music</div>
        <div className="mt-2 text-sm text-white/45">
          {trackCount} tracks across playlists, favorites, and local folders.
        </div>
      </div>

      <div className="mt-6 px-2">
        <div className="mb-3 text-[11px] uppercase tracking-[0.24em] text-white/35">Browse</div>
        <div className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const isActive = navState.view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition ${
                  isActive
                    ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                    : "text-white/65 hover:bg-white/6 hover:text-white"
                }`}
              >
                <item.icon size={16} className={isActive ? "text-sky-300" : "text-white/40"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/8 bg-white/4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">Playlists</div>
            <div className="mt-1 text-sm text-white/45">{playlists.length} collections</div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/6 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Create playlist"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="min-h-0 space-y-1 overflow-y-auto pr-1 text-sm">
          {playlists.map((playlist) => {
            const isActive = navState.view === "playlist_detail" && navState.id === playlist.id;
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onNavigate("playlist_detail", playlist.id)}
                className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition ${
                  isActive ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/6 hover:text-white"
                }`}
              >
                <span className="truncate">{playlist.name}</span>
                <span className="ml-3 text-xs text-white/35">{playlist.trackIds.length}</span>
              </button>
            );
          })}
          {playlists.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-white/40">
              Create playlists for workouts, focus sessions, and quick mixes.
            </div>
          )}
        </div>
      </div>
      {showCreateModal && (
        <CreatePlaylistModal onClose={() => setShowCreateModal(false)} />
      )}
    </aside>
  );
}
