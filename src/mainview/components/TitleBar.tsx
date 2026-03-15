import { Minus, Square, X } from "lucide-react";
import type { DesktopBridge } from "../../shared/desktop-contract";

type TitleBarSend = Pick<
  DesktopBridge["send"],
  "minimizeWindow" | "maximizeWindow" | "closeWindow"
>;

type TitleBarProps = {
  desktop?: Pick<DesktopBridge, "send">;
  title?: string;
  subtitle?: string;
  compact?: boolean;
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

      <div className="app-region-no-drag">
        <WindowControls send={send} />
      </div>
    </header>
  );
}
