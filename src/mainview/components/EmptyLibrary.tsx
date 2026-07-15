import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { FolderPlus, Music, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";

export function EmptyLibrary() {
  const rpc = useAuthStore((s) => s.rpc);
  const { addFolder, library } = useLibraryStore(
    useShallow((s) => ({
      addFolder: s.addFolder,
      library: s.library,
    })),
  );
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [defaultPath, setDefaultPath] = useState<string | null>(null);

  useEffect(() => {
    if (rpc) {
      rpc.request.getDefaultMusicPath().then(setDefaultPath);
    }
  }, [rpc]);

  const handleAddDefault = async () => {
    if (!rpc || !defaultPath) return;
    setLoading(true);
    try {
      await addFolder(defaultPath);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustom = async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    try {
      await addFolder(pathInput.trim());
      setPathInput("");
      setShowCustom(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = () => {
    navigator.clipboard.readText().then((text) => {
      const trimmed = text.trim().replace(/^["']|["']$/g, "");
      if (trimmed) setPathInput(trimmed);
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12">
      <div className="w-28 h-28 rounded-2xl bg-app-elevated flex items-center justify-center">
        <Music size={48} className="text-app-text-tertiary" />
      </div>

      <div className="text-center max-w-md">
        <h2 className="text-2xl font-bold text-app-text-primary mb-2">
          Add Your Music
        </h2>
        <p className="text-[13px] text-app-text-secondary leading-relaxed mb-6">
          Add a folder to scan for audio files. We'll search recursively for MP3, FLAC, M4A, and more.
        </p>

        {library.error && (
          <div className="flex items-center gap-2 px-4 py-3 mb-5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[13px]">
            <AlertCircle size={16} className="shrink-0" />
            <span>{library.error}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleAddDefault}
            disabled={loading || !defaultPath}
            className="flex items-center justify-center gap-3 px-6 py-3.5 bg-app-text-primary text-app-bg rounded-xl font-medium text-[14px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <FolderPlus size={18} />}
            {loading ? "Scanning..." : "Add Music Folder"}
          </button>

          {defaultPath && (
            <p className="text-[11px] text-app-text-tertiary truncate px-4">{defaultPath}</p>
          )}

          <button
            onClick={() => setShowCustom(!showCustom)}
            className="flex items-center justify-center gap-2 text-app-text-tertiary hover:text-app-text-secondary text-[13px] mt-2"
          >
            <ChevronDown size={14} className={`transition-transform ${showCustom ? "rotate-180" : ""}`} />
            {showCustom ? "Hide" : "Or add a different folder"}
          </button>

          {showCustom && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="Paste or type folder path..."
                  className="flex-1 px-3 py-2.5 bg-app-elevated border border-app-border rounded-lg text-[13px] text-app-text-primary placeholder-app-text-tertiary focus:border-app-text-tertiary outline-none"
                />
                <button
                  onClick={handlePaste}
                  className="px-3 py-2.5 bg-app-elevated border border-app-border rounded-lg text-app-text-tertiary hover:text-app-text-primary text-xs"
                >
                  Paste
                </button>
              </div>
              <button
                onClick={handleAddCustom}
                disabled={!pathInput.trim() || loading}
                className="px-4 py-2.5 bg-app-elevated hover:bg-app-active disabled:opacity-50 rounded-lg text-[13px] text-app-text-primary font-medium"
              >
                Add Folder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
