import { memo } from "react";
import { Play } from "lucide-react";
import { Collage } from "./Collage";

type GridItem = {
  id: string;
  name: string;
  desc: string;
  picture?: string;
  pictures?: string[];
};

type GridViewProps = {
  items: GridItem[];
  onItemClick: (item: GridItem) => void;
  onPlayItem?: (item: GridItem) => void;
};

export const GridView = memo(function GridView({ items, onItemClick, onPlayItem }: GridViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onItemClick(item)}
            className="text-left group rounded-xl p-3 hover:bg-app-hover transition-all"
          >
            <div className="aspect-square rounded-lg bg-app-elevated mb-3 overflow-hidden shadow-sm group-hover:shadow-lg transition-shadow relative">
              <Collage pictures={item.pictures} fallback={item.picture} />
              {onPlayItem && (
                <div
                  className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-app-text-primary shadow-xl flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayItem(item);
                  }}
                >
                  <Play size={16} className="fill-app-bg text-app-bg ml-0.5" />
                </div>
              )}
            </div>
            <div className="text-[13px] font-medium text-app-text-primary truncate leading-tight">
              {item.name}
            </div>
            <div className="text-[12px] text-app-text-tertiary truncate mt-0.5">
              {item.desc}
            </div>
          </button>
        ))}
      </div>
      {items.length === 0 && (
        <div className="flex items-center justify-center h-48 text-app-text-tertiary text-sm">
          Nothing here yet
        </div>
      )}
    </div>
  );
});
