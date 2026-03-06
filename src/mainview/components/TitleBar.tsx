import { Minus, Music4, Square, X } from "lucide-react";
import { APP_DISPLAY_NAME } from "../constants";

type ElectrobunRpc = {
  resizeWindow?: (p: { width: number; height: number }) => void;
  closeWindow?: () => void;
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
};

type TitleBarProps = {
  electrobun?: { rpc?: { send?: ElectrobunRpc } };
};

export function TitleBar({ electrobun }: TitleBarProps) {
  const send = electrobun?.rpc?.send;

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-white/8 bg-[rgba(8,12,20,0.72)] px-5 py-3 backdrop-blur-2xl">
      <div className="electrobun-webkit-app-region-no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={() => send?.minimizeWindow?.()}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#f4be4f] text-transparent transition hover:text-[#5f3c00]"
          aria-label="Minimize"
        >
          <Minus size={10} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => send?.maximizeWindow?.()}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#61c454] text-transparent transition hover:text-[#0b4a07]"
          aria-label="Maximize"
        >
          <Square size={8} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => send?.closeWindow?.()}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ed6a5e] text-transparent transition hover:text-[#5f0d08]"
          aria-label="Close"
        >
          <X size={9} strokeWidth={2.4} />
        </button>
      </div>

      <div className="electrobun-webkit-app-region-drag flex flex-1 items-center justify-center gap-2 text-sm font-medium text-white/72">
        <Music4 size={14} className="text-sky-300" />
        <span>{APP_DISPLAY_NAME}</span>
      </div>

      <div className="electrobun-webkit-app-region-no-drag text-xs uppercase tracking-[0.22em] text-white/28">
        Desktop library
      </div>
    </div>
  );
}
