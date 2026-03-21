import { Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CollageProps = {
  pictures?: string[];
  fallback?: string;
  FallbackIcon?: LucideIcon;
  iconSize?: number;
};

export function Collage({ pictures, fallback, FallbackIcon = Music, iconSize = 32 }: CollageProps) {
  const images = pictures && pictures.length > 0 ? pictures : fallback ? [fallback] : [];

  if (images.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-app-elevated to-app-surface">
        <FallbackIcon size={iconSize} className="text-app-text-tertiary" />
      </div>
    );
  }

  if (images.length === 1) {
    return <img src={images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />;
  }

  if (images.length === 2) {
    return (
      <div className="w-full h-full flex">
        <img src={images[0]} alt="" className="w-1/2 h-full object-cover border-r border-app-border-strong/50" loading="lazy" />
        <img src={images[1]} alt="" className="w-1/2 h-full object-cover" loading="lazy" />
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className="w-full h-full flex">
        <img src={images[0]} alt="" className="w-1/2 h-full object-cover border-r border-app-border-strong/50" loading="lazy" />
        <div className="w-1/2 h-full flex flex-col">
          <img src={images[1]} alt="" className="w-full h-1/2 object-cover border-b border-app-border-strong/50" loading="lazy" />
          <img src={images[2]} alt="" className="w-full h-1/2 object-cover" loading="lazy" />
        </div>
      </div>
    );
  }

  // 4 or more
  return (
    <div className="w-full h-full grid grid-cols-2 grid-rows-2">
      <img src={images[0]} alt="" className="w-full h-full object-cover border-r border-b border-app-border-strong/50" loading="lazy" />
      <img src={images[1]} alt="" className="w-full h-full object-cover border-b border-app-border-strong/50" loading="lazy" />
      <img src={images[2]} alt="" className="w-full h-full object-cover border-r border-app-border-strong/50" loading="lazy" />
      <img src={images[3]} alt="" className="w-full h-full object-cover" loading="lazy" />
    </div>
  );
}
