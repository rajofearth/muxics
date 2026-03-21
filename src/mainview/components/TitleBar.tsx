import { LogIn, LogOut, Minus, RefreshCw, Square, X } from "lucide-react";
import type { DesktopBridge } from "../../shared/desktop-contract";
import type { AuthStatus, LibrarySource } from "../types";
import { LibrarySourceSwitch } from "./LibrarySourceSwitch";

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
      className={`${hClass} shrink-0 border-b border-app-border bg-app-surface-alt/85 backdrop-blur-sm flex items-stretch select-none`}
    >
      <div
        className="app-region-drag flex-1 min-w-0 px-3 flex items-center"
        onDoubleClick={() => send?.maximizeWindow?.()}
      >
        <div className="min-w-0">
          <div
            className={`${compact ? "text-[11px]" : "text-[12px]"} font-medium leading-tight truncate`}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              className={`${compact ? "text-[10px]" : "text-[11px]"} text-app-text-tertiary leading-tight truncate`}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <div className="app-region-no-drag flex items-center">
        <div className="hidden sm:flex items-center gap-2 pr-2">
          {source && onSourceChange ? (
            <LibrarySourceSwitch value={source} onChange={onSourceChange} />
          ) : null}
          {auth?.loggedIn ? (
            <>
              <button
                type="button"
                onClick={() => onSync?.()}
                className="h-7 px-2.5 rounded-lg text-[11px] text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover inline-flex items-center gap-1.5"
                aria-label="Sync YouTube Music"
              >
                <RefreshCw size={12} />
                Sync
              </button>
              <div className="h-7 px-2.5 rounded-lg bg-app-elevated text-[11px] text-app-text-primary inline-flex items-center gap-2">
                {auth.avatarUrl ? (
                  <img
                    src={auth.avatarUrl}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-app-border-strong" />
                )}
                <span className="max-w-32 truncate">{auth.profileName ?? "YouTube Music"}</span>
              </div>
              <button
                type="button"
                onClick={() => onLogout?.()}
                className="h-7 px-2.5 rounded-lg text-[11px] text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover inline-flex items-center gap-1.5"
                aria-label="Sign out of YouTube Music"
              >
                <LogOut size={12} />
                Logout
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onLogin?.()}
              className="h-7 px-2.5 rounded-lg text-[11px] text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover inline-flex items-center gap-1.5"
              aria-label="Sign in to YouTube Music"
            >
              <LogIn size={12} />
              Sign In
            </button>
          )}
        </div>
        <WindowControls send={send} />
      </div>
    </header>
  );
}
