type TitleBarProps = {
  electrobun?: { rpc?: { send?: Record<string, unknown> } };
};

export function TitleBar(_props: TitleBarProps) {
  return (
    <div
      className="h-10 shrink-0 electrobun-webkit-app-region-drag"
      aria-hidden
    />
  );
}
