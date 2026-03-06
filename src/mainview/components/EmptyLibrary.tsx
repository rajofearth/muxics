import { useState, useEffect } from "react";
import { AlertCircle, ChevronDown, FolderPlus, Loader2, Music4 } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";

export function EmptyLibrary() {
  const { rpc, addFolder, library } = usePlayerStore();
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
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-3xl rounded-[36px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-10 text-center shadow-[0_24px_80px_rgba(2,6,16,0.36)]">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] bg-white/6">
          <Music4 size={38} className="text-sky-300" />
        </div>

        <h2 className="mt-6 text-3xl font-semibold text-white">Add your first music folder</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/48">
          Point the app at your local library and it will scan recursively for supported audio files,
          cache metadata, and build your queue-ready collection.
        </p>

        {library.error && (
          <div className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span>{library.error}</span>
          </div>
        )}

        <div className="mx-auto mt-8 flex max-w-xl flex-col gap-4">
          <button
            type="button"
            onClick={handleAddDefault}
            disabled={loading || !defaultPath}
            className="flex items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-base font-medium text-slate-950 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <FolderPlus size={20} />
            )}
            {loading ? "Scanning..." : "Add default Music folder"}
          </button>

          {defaultPath && (
            <p className="truncate px-4 text-xs text-white/40">
              {defaultPath}
            </p>
          )}

          <div className="relative pt-2">
            <button
              type="button"
              onClick={() => setShowCustom(!showCustom)}
              className="flex items-center justify-center gap-2 text-sm text-white/45 transition hover:text-white/75"
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${showCustom ? "rotate-180" : ""}`}
              />
              {showCustom ? "Hide" : "Or add a different folder"}
            </button>

            {showCustom && (
              <div className="mt-4 flex flex-col gap-3 rounded-[28px] border border-white/8 bg-white/4 p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    placeholder="Paste or type folder path..."
                    className="flex-1 rounded-full border border-white/10 bg-white/4 px-4 py-3 text-sm text-white placeholder:text-white/28 outline-none transition focus:border-sky-300/40"
                  />
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="rounded-full border border-white/10 bg-white/4 px-4 py-3 text-xs text-white/65 transition hover:bg-white/8 hover:text-white"
                  >
                    Paste
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleAddCustom}
                  disabled={!pathInput.trim() || loading}
                  className="rounded-full border border-white/10 bg-white/8 px-4 py-3 text-sm text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Folder
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
