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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-1">
          Settings
        </div>
        <h1 className="text-3xl font-bold text-app-text-primary tracking-tight mb-1">
          Music Folders
        </h1>
        <p className="text-[13px] text-app-text-secondary">
          Folders are scanned recursively for audio files
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {error && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 mb-5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[13px]">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={16} className="shrink-0" />
              <span className="truncate">{error}</span>
            </div>
            <button onClick={clearError} className="text-red-400 hover:text-red-300 shrink-0 text-xs">
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-6">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2.5 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary font-medium"
          >
            <FolderPlus size={16} />
            Add Folder
            <ChevronDown size={14} className={`transition-transform text-app-text-tertiary ${showAdd ? "rotate-180" : ""}`} />
          </button>

          {showAdd && (
            <div className="mt-3 p-5 bg-app-surface rounded-xl border border-app-border space-y-4 animate-fade-in">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider">
                  Quick Add
                </label>
                <button
                  onClick={handleAddDefault}
                  disabled={loading || !defaultPath}
                  className="flex items-center gap-2 w-fit px-4 py-2 bg-app-elevated hover:bg-app-active disabled:opacity-50 rounded-lg text-[13px] text-app-text-primary"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  {loading ? "Adding..." : "Add default Music folder"}
                </button>
                {defaultPath && (
                  <p className="text-[11px] text-app-text-tertiary break-all">{defaultPath}</p>
                )}
              </div>

              <div className="border-t border-app-border pt-4">
                <label className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider block mb-2">
                  Custom Path
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={pathInput}
                    onChange={(e) => { setPathInput(e.target.value); setLocalError(null); }}
                    placeholder="/path/to/music"
                    className="flex-1 min-w-[200px] px-3 py-2 bg-app-bg border border-app-border rounded-lg text-[13px] text-app-text-primary placeholder-app-text-tertiary focus:border-app-text-tertiary outline-none"
                  />
                  <button onClick={handlePaste} className="px-3 py-2 bg-app-bg border border-app-border rounded-lg text-app-text-tertiary hover:text-app-text-primary text-xs">
                    Paste
                  </button>
                  <button onClick={handleValidate} className="px-3 py-2 bg-app-bg border border-app-border rounded-lg text-app-text-secondary hover:text-app-text-primary text-xs">
                    Validate
                  </button>
                  <button
                    onClick={handleAddCustom}
                    disabled={!pathInput.trim() || loading}
                    className="px-4 py-2 bg-app-text-primary text-app-bg rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider mb-3">
            Folders ({settings.watchFolders.length})
          </div>
          <div className="space-y-2">
            {settings.watchFolders.map((folder) => (
              <div
                key={folder}
                className="flex items-center gap-3 px-4 py-3 bg-app-surface rounded-xl border border-app-border group"
              >
                <FolderOpen size={16} className="text-app-text-tertiary shrink-0" />
                <span className="text-[13px] text-app-text-primary truncate flex-1">{folder}</span>
                <button
                  onClick={() => removeFolder(folder)}
                  className="p-1.5 rounded-lg text-app-text-tertiary hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  aria-label="Remove folder"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {settings.watchFolders.length === 0 && (
              <div className="py-12 text-center text-app-text-tertiary">
                <FolderOpen size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-[13px]">No folders added yet</p>
                <p className="text-[11px] mt-1 text-app-text-tertiary">Click "Add Folder" above to get started</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
