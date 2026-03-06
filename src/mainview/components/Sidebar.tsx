import { useState, memo } from "react";
import {
  Library,
  Mic2,
  Disc3,
  ListMusic,
  Clock,
  FolderOpen,
  Plus,
  Search,
  LayoutList,
} from "lucide-react";
import type { NavState, NavView } from "../types";
import type { Playlist } from "../types";
import { CreatePlaylistModal } from "./CreatePlaylistModal";

type SidebarProps = {
  navState: NavState;
  playlists: Playlist[];
  onNavigate: (view: NavView, id?: string) => void;
};

const NAV_ITEMS: { id: NavView; icon: typeof Library; label: string }[] = [
  { id: "search", icon: Search, label: "Search" },
  { id: "library", icon: Library, label: "All Songs" },
  { id: "artists", icon: Mic2, label: "Artists" },
  { id: "albums", icon: Disc3, label: "Albums" },
  { id: "recent", icon: Clock, label: "Recently Played" },
  { id: "queue", icon: LayoutList, label: "Up Next" },
];

const MANAGE_ITEMS: { id: NavView; icon: typeof FolderOpen; label: string }[] = [
  { id: "playlists", icon: ListMusic, label: "All Playlists" },
  { id: "folders", icon: FolderOpen, label: "Folders" },
];

export const Sidebar = memo(function Sidebar({ navState, playlists, onNavigate }: SidebarProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  const NavButton = ({ id, icon: Icon, label }: { id: NavView; icon: typeof Library; label: string }) => {
    const isActive =
      navState.view === id ||
      (id === "artists" && navState.view === "artist_detail") ||
      (id === "albums" && navState.view === "album_detail") ||
      (id === "playlists" && navState.view === "playlist_detail");

    return (
      <button
        onClick={() => onNavigate(id)}
        className={`w-full flex items-center gap-3 px-3 py-[7px] text-[13px] rounded-lg transition-all ${
          isActive
            ? "bg-app-active text-app-text-primary font-medium"
            : "text-app-text-secondary hover:bg-app-hover hover:text-app-text-primary"
        }`}
      >
        <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
        {label}
      </button>
    );
  };

  return (
    <div className="w-56 border-r border-app-border bg-app-surface-alt flex flex-col shrink-0 select-none">
      <div className="p-3 pt-2 flex-1 overflow-y-auto">
        <div className="mb-1">
          <div className="px-3 py-1.5 text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider">
            Library
          </div>
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <NavButton key={item.id} {...item} />
            ))}
          </div>
        </div>

        <div className="mt-4 mb-1">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider">
              Playlists
            </span>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-0.5 rounded text-app-text-tertiary hover:text-app-text-primary hover:bg-app-hover"
              aria-label="Create playlist"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-0.5">
            {MANAGE_ITEMS.map((item) => (
              <NavButton key={item.id} {...item} />
            ))}
          </div>
        </div>

        {playlists.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {playlists.map((pl) => {
              const isActive = navState.view === "playlist_detail" && navState.id === pl.id;
              return (
                <button
                  key={pl.id}
                  onClick={() => onNavigate("playlist_detail", pl.id)}
                  className={`w-full text-left px-3 py-[7px] text-[13px] rounded-lg truncate transition-all ${
                    isActive
                      ? "bg-app-active text-app-text-primary font-medium"
                      : "text-app-text-secondary hover:bg-app-hover hover:text-app-text-primary"
                  }`}
                >
                  {pl.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showCreateModal && <CreatePlaylistModal onClose={() => setShowCreateModal(false)} />}
    </div>
  );
});
