import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react";

type MenuItem = {
  label: string;
  action: string;
  accelerator?: string;
  icon?: React.ReactNode;
};

type MenuSeparator = { type: "separator" };

const MENU_ITEMS: (MenuItem | MenuSeparator)[] = [
  { label: "Play / Pause", action: "playPause", accelerator: "Space" },
  { label: "Previous", action: "prev", accelerator: "←", icon: <SkipBack size={14} /> },
  { label: "Next", action: "next", accelerator: "→", icon: <SkipForward size={14} /> },
  { type: "separator" },
  { label: "Close", action: "close", accelerator: "⌘Q", icon: <X size={14} /> },
];

type WinampContextMenuProps = {
  x: number;
  y: number;
  isPlaying: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
};

export function WinampContextMenu({ x, y, isPlaying, onAction, onClose }: WinampContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let adjX = x, adjY = y;
    if (x + rect.width > window.innerWidth) adjX = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) adjY = window.innerHeight - rect.height - 8;
    if (adjX !== x || adjY !== y) setPosition({ x: adjX, y: adjY });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] py-1.5 rounded-xl border border-app-border shadow-2xl bg-app-surface/95 backdrop-blur-xl text-[13px] animate-fade-in"
      style={{ left: position.x, top: position.y }}
    >
      {MENU_ITEMS.map((item, i) => {
        if ("type" in item) {
          return <div key={`sep-${i}`} className="my-1 h-px bg-app-border mx-2" />;
        }
        const mi = item as MenuItem;
        return (
          <button
            key={mi.action}
            type="button"
            onClick={() => { onAction(mi.action); onClose(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-app-text-primary hover:bg-app-hover rounded-md mx-0"
          >
            {mi.action === "playPause" ? (
              isPlaying ? <Pause size={14} /> : <Play size={14} />
            ) : mi.icon}
            <span className="flex-1">{mi.label}</span>
            {mi.accelerator && (
              <span className="text-app-text-tertiary text-[11px]">{mi.accelerator}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
