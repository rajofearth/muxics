import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, LogIn, LogOut, Minus, Music, FolderOpen, Library, RefreshCw, Square, User, X } from "lucide-react";
import type { DesktopBridge } from "../../shared/desktop-contract";
import type { AuthStatus, LibrarySource } from "../types";

type TitleBarSend = Pick<
  DesktopBridge["send"],
  "minimizeWindow" | "maximizeWindow" | "closeWindow"
>;

type TitleBarProps = {
  desktop?: Pick<DesktopBridge, "send">;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  auth?: AuthStatus;
  source?: LibrarySource;
  onSourceChange?: (source: LibrarySource) => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onSync?: () => void;
};

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return { open, toggle, close, ref };
}

const SOURCE_OPTIONS: { id: LibrarySource; label: string; icon: typeof Library }[] = [
  { id: "all", label: "All", icon: Library },
  { id: "local", label: "Local", icon: FolderOpen },
  { id: "ytmusic", label: "YT Music", icon: Music },
];

function SourceDropdown({
  source,
  onSourceChange,
}: {
  source: LibrarySource;
  onSourceChange: (source: LibrarySource) => void;
}) {
  const { open, toggle, close, ref } = useDropdown();
  const active = SOURCE_OPTIONS.find((o) => o.id === source) ?? SOURCE_OPTIONS[0];
  const ActiveIcon = active.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 bg-app-elevated hover:bg-app-active px-3 py-1.5 rounded-lg text-[12px] transition-colors border border-app-border"
      >
        <ActiveIcon size={14} className="text-app-accent" />
        <span className="text-app-text-primary">{active.label}</span>
        <ChevronDown size={14} className="text-app-text-tertiary" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-40 bg-app-elevated border border-app-border-strong rounded-xl shadow-2xl z-50 py-1 animate-fade-in">
          {SOURCE_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onSourceChange(id);
                close();
              }}
              className={`w-full flex items-center gap-3 px-4 py-2 text-[12px] hover:bg-app-hover text-left transition-colors ${
                source === id ? "bg-app-hover text-app-text-primary" : "text-app-text-secondary"
              }`}
            >
              <Icon size={14} className={source === id ? "text-app-accent" : ""} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileDropdown({
  auth,
  onSync,
  onLogout,
}: {
  auth: AuthStatus;
  onSync?: () => void;
  onLogout?: () => void;
}) {
  const { open, toggle, close, ref } = useDropdown();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 bg-app-elevated hover:bg-app-active px-3 py-1.5 rounded-lg text-[12px] transition-colors border border-app-border"
      >
        {auth.avatarUrl ? (
          <img
            src={auth.avatarUrl}
            alt=""
            className="w-5 h-5 rounded-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-app-border-strong flex items-center justify-center">
            <User size={12} className="text-app-text-tertiary" />
          </div>
        )}
        <span className="text-app-text-primary max-w-28 truncate">
          {auth.profileName ?? "Account"}
        </span>
        <ChevronDown size={14} className="text-app-text-tertiary" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-48 bg-app-elevated border border-app-border-strong rounded-xl shadow-2xl z-50 py-1 animate-fade-in">
          <button
            type="button"
            onClick={() => {
              onSync?.();
              close();
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-[12px] text-app-text-secondary hover:bg-app-hover text-left transition-colors"
          >
            <RefreshCw size={14} />
            Sync
          </button>
          <div className="h-1px bg-app-border my-1" />
          <button
            type="button"
            onClick={() => {
              onLogout?.();
              close();
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-[12px] text-red-400 hover:bg-app-hover text-left transition-colors"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

function WindowControls({ send }: { send?: TitleBarSend }) {
  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        onClick={() => send?.minimizeWindow?.()}
        className="h-full w-11 flex items-center justify-center text-app-text-secondary hover:bg-app-hover hover:text-app-text-primary transition-colors"
        aria-label="Minimize window"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => send?.maximizeWindow?.()}
        className="h-full w-11 flex items-center justify-center text-app-text-secondary hover:bg-app-hover hover:text-app-text-primary transition-colors"
        aria-label="Maximize window"
      >
        <Square size={11} />
      </button>
      <button
        type="button"
        onClick={() => send?.closeWindow?.()}
        className="h-full w-11 flex items-center justify-center text-app-text-secondary hover:bg-[#d43737] hover:text-white transition-colors"
        aria-label="Close window"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function TitleBar({
  desktop,
  title = "Muxics",
  subtitle,
  compact = false,
  auth,
  source,
  onSourceChange,
  onLogin,
  onLogout,
  onSync,
}: TitleBarProps) {
  const hClass = compact ? "h-8" : "h-10";
  const send = desktop?.send;

  return (
    <header
      className={`${hClass} shrink-0 border-b border-app-border bg-app-surface-alt/85 backdrop-blur-sm flex items-stretch select-none relative z-50`}
    >
      {/* Draggable left area — title */}
      <div
        className="app-region-drag flex-1 min-w-0 px-4 flex items-center"
        onDoubleClick={() => send?.maximizeWindow?.()}
      >
        <div className="min-w-0">
          <div className="flex flex-col">
            <span
              className={`${compact ? "text-[13px]" : "text-[15px]"} font-bold leading-tight truncate tracking-tight`}
            >
              {title}
            </span>
            {subtitle ? (
              <span
                className={`${compact ? "text-[9px]" : "text-[10px]"} text-app-text-tertiary uppercase tracking-widest leading-none`}
              >
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right area — dropdowns + window controls */}
      <div className="app-region-no-drag flex items-center gap-3 pr-0">
        <div className="hidden sm:flex items-center gap-2">
          {source && onSourceChange ? (
            <SourceDropdown source={source} onSourceChange={onSourceChange} />
          ) : null}

          {auth?.loggedIn ? (
            <ProfileDropdown auth={auth} onSync={onSync} onLogout={onLogout} />
          ) : (
            <button
              type="button"
              onClick={() => onLogin?.()}
              className="flex items-center gap-2 bg-app-elevated hover:bg-app-active px-3 py-1.5 rounded-lg text-[12px] transition-colors border border-app-border text-app-text-secondary hover:text-app-text-primary"
            >
              <LogIn size={14} />
              Sign In
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-1px bg-app-border-strong mx-1" />

        <WindowControls send={send} />
      </div>
    </header>
  );
}
