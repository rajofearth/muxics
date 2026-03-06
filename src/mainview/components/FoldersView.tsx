import { useState, useEffect } from "react";
import { FolderPlus, Trash2, Loader2, AlertCircle, ChevronDown, FolderOpen } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";

export function FoldersView() {
  const { settings, addFolder, removeFolder, library, rpc } = usePlayerStore();
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [defaultPath, setDefaultPath] = useState<string | null>(null);

  useEffect(() => {
    if (rpc) {
      rpc.request.getDefaultMusicPath().then(setDefaultPath);
    }
  }, [rpc]);

  const clearError = () => {
    setLocalError(null);
    usePlayerStore.setState((s) => ({
      library: { ...s.library, error: null },
    }));
  };

  const handleAddDefault = async () => {
    if (!rpc || !defaultPath) return;
    setLoading(true);
    setLocalError(null);
    try {
      await addFolder(defaultPath);
      setShowAdd(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustom = async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    setLocalError(null);
    try {
      await addFolder(pathInput.trim());
      setPathInput("");
      setShowAdd(false);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!rpc || !pathInput.trim()) return;
    const result = await rpc.request.validateFolder({ path: pathInput.trim() });
    if (result.valid && result.resolvedPath) {
      setPathInput(result.resolvedPath);
      setLocalError(null);
    } else {
      setLocalError(result.error ?? "Invalid path");
    }
  };

  const handlePaste = () => {
    navigator.clipboard.readText().then((text) => {
      const trimmed = text.trim().replace(/^["']|["']$/g, "");
      if (trimmed) setPathInput(trimmed);
    });
  };

  const error = localError ?? library.error;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Settings</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">Watch folders</h1>
        <p className="mt-2 text-sm text-white/48">
          These locations are scanned recursively for local audio files.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div
            className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-500/8 px-4 py-3 text-sm text-red-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={18} className="flex-shrink-0" />
              <span className="truncate">{error}</span>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="flex-shrink-0 px-2 text-red-200 transition hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-8 rounded-[30px] border border-white/8 bg-[rgba(12,18,28,0.82)] p-6 shadow-[0_20px_70px_rgba(3,8,18,0.34)]">
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2.5 text-sm text-white transition hover:bg-white/10"
          >
            <FolderPlus size={18} />
            Add folder
            <ChevronDown
              size={16}
              className={`transition-transform ${showAdd ? "rotate-180" : ""}`}
            />
          </button>

          {showAdd && (
            <div className="mt-5 space-y-5 rounded-[28px] border border-white/8 bg-black/18 p-5">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                  QUICK ADD
                </label>
                <button
                  type="button"
                  onClick={handleAddDefault}
                  disabled={loading || !defaultPath}
                  className="flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <FolderOpen size={16} />
                  )}
                  {loading ? "Adding..." : "Add default Music folder"}
                </button>
                {defaultPath && (
                  <p className="break-all text-xs text-white/40">
                    {defaultPath}
                  </p>
                )}
              </div>

              <div className="border-t border-white/8 pt-4">
                <label className="mb-2 block text-[11px] uppercase tracking-[0.24em] text-white/38">
                  CUSTOM PATH
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={pathInput}
                    onChange={(e) => {
                      setPathInput(e.target.value);
                      setLocalError(null);
                    }}
                    placeholder="/Users/you/Music"
                    className="min-w-[200px] flex-1 rounded-full border border-white/10 bg-white/4 px-4 py-3 text-sm text-white placeholder:text-white/28 outline-none transition focus:border-sky-300/40"
                  />
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="rounded-full border border-white/10 bg-white/4 px-4 py-3 text-xs text-white/65 transition hover:bg-white/8 hover:text-white"
                  >
                    Paste
                  </button>
                  <button
                    type="button"
                    onClick={handleValidate}
                    className="rounded-full border border-white/10 bg-white/4 px-4 py-3 text-xs text-white/78 transition hover:bg-white/8"
                  >
                    Validate
                  </button>
                  <button
                    type="button"
                    onClick={handleAddCustom}
                    disabled={!pathInput.trim() || loading}
                    className="rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-950 hover:opacity-95 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 text-[11px] uppercase tracking-[0.24em] text-white/38">
            FOLDERS ({settings.watchFolders.length})
          </div>
          <div className="space-y-2">
            {settings.watchFolders.map((folder) => (
              <div
                key={folder}
                className="group flex items-center gap-3 rounded-[24px] border border-white/8 bg-[rgba(12,18,28,0.82)] px-4 py-3 shadow-[0_20px_70px_rgba(3,8,18,0.24)]"
              >
                <FolderOpen size={16} className="flex-shrink-0 text-emerald-300" />
                <span className="flex-1 truncate text-sm text-white/78">
                  {folder}
                </span>
                <button
                  type="button"
                  onClick={() => removeFolder(folder)}
                  className="p-2 text-white/35 opacity-70 transition group-hover:opacity-100 hover:text-red-300"
                  aria-label="Remove folder"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {settings.watchFolders.length === 0 && (
              <div className="rounded-[28px] border border-dashed border-white/10 py-16 text-center text-white/42">
                <FolderOpen size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">No folders added yet.</p>
                <p className="text-xs mt-1">Click &quot;Add folder&quot; above to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
