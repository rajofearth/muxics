import { memo } from "react";
import { FolderOpen, Library, Music } from "lucide-react";
import type { LibrarySource } from "../types";

type SourceOption = {
  id: LibrarySource;
  label: string;
  icon: typeof Library;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { id: "all", label: "All", icon: Library },
  { id: "local", label: "Local", icon: FolderOpen },
  { id: "ytmusic", label: "YT Music", icon: Music },
];

type LibrarySourceSwitchProps = {
  value: LibrarySource;
  onChange: (source: LibrarySource) => void;
};

export const LibrarySourceSwitch = memo(function LibrarySourceSwitch({
  value,
  onChange,
}: LibrarySourceSwitchProps) {
  return (
    <div className="hidden md:flex items-center rounded-full border border-app-border bg-app-elevated/80 p-0.5 shadow-sm">
      {SOURCE_OPTIONS.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={active}
            className={`h-7 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
              active
                ? "bg-app-text-primary text-app-bg shadow-sm"
                : "text-app-text-secondary hover:text-app-text-primary hover:bg-app-hover"
            }`}
          >
            <Icon size={12} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
});
