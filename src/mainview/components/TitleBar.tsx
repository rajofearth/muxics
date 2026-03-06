// macOS-style traffic light buttons don't use icons

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
    <div className="flex items-center h-10 px-3 border-b border-app-border bg-app-surface shrink-0 electrobun-webkit-app-region-drag">
      <div className="flex items-center gap-2 electrobun-webkit-app-region-no-drag">
        <button
          onClick={() => send?.closeWindow?.()}
          className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 cursor-pointer"
          aria-label="Close"
        />
        <button
          onClick={() => send?.minimizeWindow?.()}
          className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 cursor-pointer"
          aria-label="Minimize"
        />
        <button
          onClick={() => send?.maximizeWindow?.()}
          className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 cursor-pointer"
          aria-label="Maximize"
        />
      </div>
    </div>
  );
}
