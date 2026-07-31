import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CacheStatsResult,
  DesktopBridge,
  DesktopSettings,
} from "../../shared/desktop-contract";
import { showToast } from "./Toast";
import { useLibraryStore } from "../store/libraryStore";
import { useAuthStore } from "../store/authStore";
import { useUiStore } from "../store/uiStore";
import { useShallow } from "zustand/react/shallow";
import {
  FolderPlus,
  Trash2,
  Loader2,
  AlertCircle,
  ChevronDown,
  FolderOpen,
  Palette,
  HardDrive,
  Library,
  Info,
  Download,
  RefreshCw,
  Puzzle,
} from "lucide-react";
// @ts-expect-error vite svg import
import appIcon from "../../../assets/muzics-dark.svg";

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return { open, toggle, close, ref };
}

const THEME_OPTIONS = [
  {
    id: "default",
    label: "Default Dark",
    desc: "Elegant charcoal background with subtle contrast",
    swatches: ["#0a0a0a", "#141414", "#1a1a1a"],
  },
  {
    id: "darker",
    label: "Pitch Black",
    desc: "Pure black OLED background with high contrast",
    swatches: ["#000000", "#121212", "#1a1a1a"],
  },
] as const;

const CACHE_LIMIT_OPTIONS = [1, 2, 3, 5, 10]; // GB

function ThemeDropdown({
  themeName,
  setThemeName,
}: {
  themeName: string;
  setThemeName: (id: string) => void;
}) {
  const { open, toggle, close, ref } = useDropdown();
  const activeOpt =
    THEME_OPTIONS.find((o) => o.id === themeName) || THEME_OPTIONS[0];

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-app-border bg-app-bg hover:border-app-border-strong transition-all focus:outline-none focus:ring-2 focus:ring-app-accent/50 group"
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 shrink-0 rounded overflow-hidden border border-white/10 shadow-sm">
            {activeOpt.swatches.map((c) => (
              <div
                key={c}
                className="w-3.5 h-3.5"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-app-text-primary">
            {activeOpt.label}
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-app-text-tertiary transition-transform duration-200 ${open ? "rotate-180" : "group-hover:text-app-text-secondary"}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 p-1.5 bg-app-elevated border border-app-border-strong rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto animate-fade-in ring-1 ring-black/50">
          {THEME_OPTIONS.map((opt) => {
            const isActive = themeName === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setThemeName(opt.id);
                  close();
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-colors ${
                  isActive ? "bg-app-active" : "hover:bg-app-hover"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5 shrink-0 rounded overflow-hidden border border-white/10 shadow-sm">
                    {opt.swatches.map((c) => (
                      <div
                        key={c}
                        className="w-3.5 h-3.5"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-app-text-primary">
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-app-text-tertiary mt-0.5">
                      {opt.desc}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Palette;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 bg-app-surface border border-app-border rounded-lg text-app-accent mt-0.5">
        <Icon size={16} />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-app-text-primary tracking-tight leading-tight">
          {title}
        </h2>
        <p className="text-[12px] text-app-text-tertiary mt-1">{desc}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export function SettingsView({ desktop }: { desktop?: DesktopBridge }) {
  const themeName = useUiStore((s) => s.themeName);
  const setThemeName = useUiStore((s) => s.setThemeName);

  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [usageBytes, setUsageBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<string>("");

  // Compute current GB limit from settings
  const limitGb = useMemo(
    () =>
      Math.max(
        1,
        Math.round(
          (settings?.ytmusicCacheLimitBytes ?? 1024 ** 3) /
            (1024 * 1024 * 1024),
        ),
      ),
    [settings?.ytmusicCacheLimitBytes],
  );

  const { playerSettings, addFolder, removeFolder, library, syncYtMusicLibrary } =
    useLibraryStore(
      useShallow((s) => ({
        playerSettings: s.settings,
        addFolder: s.addFolder,
        removeFolder: s.removeFolder,
        library: s.library,
        syncYtMusicLibrary: s.syncYtMusicLibrary,
      })),
    );

  const { auth, rpc, authLogin, loadAuthStatus, clearAuthLoginError } =
    useAuthStore(
      useShallow((s) => ({
        auth: s.auth,
        rpc: s.rpc,
        authLogin: s.authLogin,
        loadAuthStatus: s.loadAuthStatus,
        clearAuthLoginError: s.clearAuthLoginError,
      })),
    );

  const [pathInput, setPathInput] = useState("");
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [defaultPath, setDefaultPath] = useState<string | null>(null);

  // Browser extension state
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeFolderPath, setBridgeFolderPath] = useState<string | null>(null);
  const [bridgeZipPath, setBridgeZipPath] = useState<string | null>(null);
  const [bridgeExtensionId, setBridgeExtensionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!desktop) return;
      const [nextSettings, stats, version] = await Promise.all([
        desktop.request.getSettings(),
        desktop.request.getYtMusicCacheStats(),
        desktop.request.getAppVersion(),
      ]);
      if (cancelled) return;
      setSettings(nextSettings);
      setUsageBytes(stats.usageBytes);
      setAppVersion(version);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return undefined;
    const onStats = (e: Event) => {
      const detail = (e as CustomEvent<CacheStatsResult>).detail;
      if (detail?.usageBytes != null) setUsageBytes(detail.usageBytes);
    };
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setUpdateStatus(detail.status);
    };
    document.addEventListener("muxics-yt-cache-stats", onStats);
    document.addEventListener("muxics-auto-update", onUpdate);
    return () => {
      document.removeEventListener("muxics-yt-cache-stats", onStats);
      document.removeEventListener("muxics-auto-update", onUpdate);
    };
  }, [desktop]);

  useEffect(() => {
    if (rpc) {
      rpc.request.getDefaultMusicPath().then(setDefaultPath);
    }
  }, [rpc]);

  const persistLimit = async (gb: number) => {
    if (!desktop || !settings) return;
    const nextBytes = gb * 1024 * 1024 * 1024;
    const prev = settings;
    const next = { ...settings, ytmusicCacheLimitBytes: nextBytes };
    setSettings(next);
    try {
      await desktop.request.saveSettings({ ytmusicCacheLimitBytes: nextBytes });
      showToast(`Cache limit updated to ${gb} GB`);
      const stats = await desktop.request.getYtMusicCacheStats();
      setUsageBytes(stats.usageBytes);
    } catch (error) {
      setSettings(prev);
      console.error("Failed to save settings:", error);
      showToast("Failed to save limit.", "error");
    }
  };

  const clearMediaCache = async () => {
    if (!desktop) return;
    try {
      await desktop.request.clearYtMusicCache();
      const stats = await desktop.request.getYtMusicCacheStats();
      setUsageBytes(stats.usageBytes);
      showToast("Media cache cleared.");
    } catch (error) {
      console.error("Failed to clear media cache:", error);
      showToast("Failed to clear media cache.", "error");
    }
  };

  const clearMetadataCache = async () => {
    if (!desktop) return;
    try {
      await desktop.request.clearYtMusicMetadataCache();
      showToast("Library metadata cleared.");
    } catch (error) {
      console.error("Failed to clear metadata cache:", error);
      showToast("Failed to clear metadata.", "error");
    }
  };

  const handlePrepareExtension = useCallback(async () => {
    if (!desktop) return;
    setBridgeBusy(true);
    clearAuthLoginError();
    try {
      const result = await desktop.request.prepareBrowserBridge();
      if (!result?.success) {
        showToast(
          result?.error ?? "Could not prepare the browser extension.",
          "error",
        );
        return;
      }
      setBridgeExtensionId(result.extensionId);
      setBridgeFolderPath(result.folderPath ?? null);
      setBridgeZipPath(result.zipPath ?? null);
      showToast("Extension files are ready.");
    } catch (err) {
      console.error("handlePrepareExtension failed:", err);
      showToast(
        err instanceof Error
          ? err.message
          : "Failed to prepare extension files.",
        "error",
      );
    } finally {
      setBridgeBusy(false);
    }
  }, [clearAuthLoginError, desktop]);

  const handleRefreshConnection = useCallback(async () => {
    if (!desktop) return;
    setBridgeBusy(true);
    try {
      await loadAuthStatus();
      const { auth } = useAuthStore.getState();
      if (!auth.loggedIn) {
        showToast("No browser session received yet.", "info");
        return;
      }

      // Sync to validate the session actually works
      await syncYtMusicLibrary();

      // Check result after sync completes
      const updatedAuth = useAuthStore.getState().auth;
      if (updatedAuth.sessionExpired) {
        showToast(
          "Session rejected. Open the extension and click Send Session To Muxics.",
          "error",
        );
      } else {
        showToast("YouTube Music is connected.");
      }
    } catch (err) {
      console.error("handleRefreshConnection failed:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to refresh connection.",
        "error",
      );
    } finally {
      setBridgeBusy(false);
    }
  }, [desktop, loadAuthStatus, syncYtMusicLibrary]);

  const clearFolderError = () => {
    setLocalError(null);
    useLibraryStore.setState((s) => ({
      library: { ...s.library, error: null },
    }));
  };

  const handleAddDefault = async () => {
    if (!rpc || !defaultPath) return;
    setFoldersLoading(true);
    setLocalError(null);
    try {
      await addFolder(defaultPath);
      setShowAdd(false);
    } finally {
      setFoldersLoading(false);
    }
  };

  const handleAddCustom = async () => {
    if (!pathInput.trim()) return;
    setFoldersLoading(true);
    setLocalError(null);
    try {
      await addFolder(pathInput.trim());
      setPathInput("");
      setShowAdd(false);
    } finally {
      setFoldersLoading(false);
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

  const folderError = localError ?? library.error;

  const handleCheckForUpdates = () => {
    if (!desktop) return;
    setUpdateStatus("checking");
    desktop.request.checkForUpdates();
  };

  function formattedUsage(): string {
    if (usageBytes >= 1024 * 1024 * 1024) {
      return `${(usageBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${Math.round(usageBytes / (1024 * 1024))} MB`;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app-bg">
      <div className="px-8 pt-10 pb-6 shrink-0">
        <h1 className="text-[28px] font-bold text-app-text-primary tracking-tight">
          Settings
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-12">
        <div className="max-w-2xl space-y-10">
          {/* ── Appearance ── */}
          <section>
            <SectionHeader
              icon={Palette}
              title="Appearance"
              desc="Customize the visual style and colors"
            />
            <div className="pl-11">
              <ThemeDropdown
                themeName={themeName}
                setThemeName={setThemeName}
              />
            </div>
          </section>

          <div className="h-px bg-app-border" />

          {/* ── Storage & Cache ── */}
          <section>
            <SectionHeader
              icon={HardDrive}
              title="Storage & Cache"
              desc="Manage disk usage for YouTube Music streams and artwork"
            />
            <div className="pl-11 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[13px] font-medium text-app-text-primary">
                    Cache Limit
                  </label>
                  <div className="text-[12px] font-medium text-app-text-secondary bg-app-surface border border-app-border px-2 py-0.5 rounded shadow-sm tabular-nums">
                    {loading ? "…" : `${formattedUsage()} used`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CACHE_LIMIT_OPTIONS.map((gb) => {
                    const isActive = limitGb === gb;
                    return (
                      <button
                        key={gb}
                        type="button"
                        onClick={() => persistLimit(gb)}
                        disabled={loading || !settings}
                        className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors border shadow-sm ${
                          isActive
                            ? "bg-app-accent border-app-accent text-white"
                            : "bg-app-surface border-app-border text-app-text-primary hover:bg-app-hover hover:border-app-border-strong disabled:opacity-50"
                        }`}
                      >
                        {gb} GB
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 bg-app-surface rounded-xl border border-app-border">
                <div className="mb-4">
                  <div className="text-[13px] font-medium text-app-text-primary">
                    Free up space
                  </div>
                  <div className="text-[12px] text-app-text-tertiary mt-0.5">
                    Clearing won't remove your settings or account
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={loading || !settings}
                    onClick={() => void clearMediaCache()}
                    className="px-4 py-2 bg-app-bg hover:bg-app-hover rounded-lg text-[13px] text-app-text-primary font-medium border border-app-border shadow-sm transition-colors"
                  >
                    Clear media cache
                  </button>
                  <button
                    type="button"
                    disabled={loading || !settings}
                    onClick={() => void clearMetadataCache()}
                    className="px-4 py-2 bg-app-bg hover:bg-app-hover rounded-lg text-[13px] text-app-text-primary font-medium border border-app-border shadow-sm transition-colors"
                  >
                    Clear library metadata
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="h-px bg-app-border" />

          {/* ── Local Library Folders ── */}
          <section>
            <SectionHeader
              icon={Library}
              title="Local Library"
              desc="Folders scanned recursively for local audio files"
            />
            <div className="pl-11">
              {folderError && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[13px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle size={16} className="shrink-0" />
                    <span className="truncate">{folderError}</span>
                  </div>
                  <button
                    onClick={clearFolderError}
                    className="text-red-400 hover:text-red-300 shrink-0 text-xs"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="mb-4">
                <button
                  onClick={() => setShowAdd(!showAdd)}
                  className="flex items-center gap-2 px-4 py-2 bg-app-surface hover:bg-app-hover border border-app-border rounded-lg text-[13px] text-app-text-primary font-medium shadow-sm transition-colors"
                >
                  <FolderPlus size={16} className="text-app-text-secondary" />
                  Add Folder
                  <ChevronDown
                    size={14}
                    className={`text-app-text-tertiary ml-1 transition-transform ${showAdd ? "rotate-180" : ""}`}
                  />
                </button>

                {showAdd && (
                  <div className="mt-3 p-5 rounded-xl border bg-app-surface border-app-border space-y-5 animate-fade-in shadow-sm">
                    <div>
                      <label className="text-[12px] font-medium text-app-text-primary mb-2 block">
                        Quick Add
                      </label>
                      <button
                        onClick={handleAddDefault}
                        disabled={foldersLoading || !defaultPath}
                        className="flex items-center gap-2 px-4 py-2 bg-app-bg hover:bg-app-hover disabled:opacity-50 rounded-lg text-[13px] text-app-text-primary border border-app-border transition-colors shadow-sm"
                      >
                        {foldersLoading ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <FolderOpen
                            size={16}
                            className="text-app-text-secondary"
                          />
                        )}
                        {foldersLoading
                          ? "Adding..."
                          : "Add default Music folder"}
                      </button>
                      {defaultPath && (
                        <p className="text-[11px] text-app-text-tertiary mt-2 break-all pl-1">
                          {defaultPath}
                        </p>
                      )}
                    </div>

                    <div className="h-px bg-app-border" />

                    <div>
                      <label className="text-[12px] font-medium text-app-text-primary mb-2 block">
                        Custom Path
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={pathInput}
                          onChange={(e) => {
                            setPathInput(e.target.value);
                            setLocalError(null);
                          }}
                          placeholder="/path/to/music"
                          className="flex-1 min-w-[200px] px-3 py-2 bg-app-bg border border-app-border rounded-lg text-[13px] text-app-text-primary placeholder-app-text-tertiary focus:border-app-text-secondary focus:ring-1 focus:ring-app-text-secondary outline-none shadow-sm"
                        />
                        <button
                          onClick={handlePaste}
                          className="px-3 py-2 bg-app-bg hover:bg-app-hover border border-app-border rounded-lg text-app-text-secondary hover:text-app-text-primary text-[12px] shadow-sm font-medium transition-colors"
                        >
                          Paste
                        </button>
                        <button
                          onClick={handleValidate}
                          className="px-3 py-2 bg-app-bg hover:bg-app-hover border border-app-border rounded-lg text-app-text-secondary hover:text-app-text-primary text-[12px] shadow-sm font-medium transition-colors"
                        >
                          Validate
                        </button>
                        <button
                          onClick={handleAddCustom}
                          disabled={!pathInput.trim() || foldersLoading}
                          className="px-5 py-2 bg-app-text-primary text-app-bg rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-50 shadow-sm"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {playerSettings.watchFolders.map((folder) => (
                  <div
                    key={folder}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-app-surface border-app-border group shadow-sm"
                  >
                    <FolderOpen
                      size={16}
                      className="text-app-text-tertiary shrink-0"
                    />
                    <span className="text-[13px] text-app-text-primary truncate flex-1">
                      {folder}
                    </span>
                    <button
                      onClick={() => removeFolder(folder)}
                      className="p-1.5 rounded-lg text-app-text-tertiary hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                      aria-label="Remove folder"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {playerSettings.watchFolders.length === 0 && (
                  <div className="py-10 text-center rounded-xl border bg-app-surface border-app-border border-dashed">
                    <FolderOpen
                      size={32}
                      className="mx-auto mb-3 text-app-text-tertiary opacity-40"
                    />
                    <p className="text-[13px] text-app-text-secondary font-medium">
                      No folders added
                    </p>
                    <p className="text-[12px] text-app-text-tertiary mt-1">
                      Add local folders to scan them into your library
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="h-px bg-app-border" />
          {/* ── Browser Extension ── */}
          <section>
            <SectionHeader
              icon={Puzzle}
              title="Browser Extension"
              desc="Connect YouTube Music by installing the Muxics browser extension"
            />
            <div className="pl-11 space-y-4">
              {authLogin.error && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
                  {authLogin.error}
                </div>
              )}

              {/* ── Connection status ── */}
              <div className="flex items-center justify-between p-3 bg-app-surface rounded-xl border border-app-border">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`relative w-2 h-2 rounded-full ${
                      auth.loggedIn && !auth.sessionExpired
                        ? "bg-green-500"
                        : "bg-app-text-tertiary"
                    }`}
                  >
                    {auth.loggedIn && !auth.sessionExpired && (
                      <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-40" />
                    )}
                  </span>
                  <span className="text-[13px] font-medium text-app-text-primary">
                    {auth.loggedIn && !auth.sessionExpired
                      ? "Connected"
                      : "Not Connected"}
                  </span>
                </div>
                <span className="text-[11px] text-app-text-tertiary">
                  {auth.loggedIn && !auth.sessionExpired
                    ? auth.lastSyncedAt
                      ? `Synced ${formatTimeAgo(auth.lastSyncedAt)}`
                      : "YouTube Music linked"
                    : auth.sessionExpired
                      ? "Session expired"
                      : "Not linked"}
                </span>
              </div>

              {/* ── Actions ── */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrepareExtension}
                  disabled={bridgeBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg hover:opacity-90 disabled:opacity-60"
                >
                  <Download size={14} />
                  Prepare Files
                </button>
                <button
                  type="button"
                  onClick={handleRefreshConnection}
                  disabled={bridgeBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active disabled:opacity-60"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>

              {/* ── File access ── */}
              {(bridgeZipPath || bridgeFolderPath) && (
                <div className="flex flex-wrap items-center gap-2">
                  {bridgeZipPath && (
                    <button
                      type="button"
                      onClick={() =>
                        void desktop?.request.openPath({ path: bridgeZipPath })
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-3 py-2 text-[12px] text-app-text-primary hover:bg-app-active"
                    >
                      <FolderOpen size={13} />
                      Open ZIP
                    </button>
                  )}
                  {bridgeFolderPath && (
                    <button
                      type="button"
                      onClick={() =>
                        void desktop?.request.openPath({
                          path: bridgeFolderPath,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-3 py-2 text-[12px] text-app-text-primary hover:bg-app-active"
                    >
                      <FolderOpen size={13} />
                      Open Extension Folder
                    </button>
                  )}
                </div>
              )}

              {/* ── Setup guide (collapsible) ── */}
              <details className="group">
                <summary className="text-[12px] text-app-text-tertiary hover:text-app-text-secondary cursor-pointer transition-colors list-none flex items-center gap-1.5">
                  <ChevronDown
                    size={13}
                    className="transition-transform group-open:rotate-180"
                  />
                  Setup guide
                </summary>
                <div className="mt-3 p-3 bg-app-surface rounded-xl border border-app-border text-[12px] text-app-text-secondary space-y-1.5">
                  <p>1. Keep Muxics running.</p>
                  <p>
                    2. Click Prepare Files above to generate the extension
                    bundle.
                  </p>
                  <p>3. In Chrome/Edge, go to Extensions → Load unpacked.</p>
                  <p>4. Select the extension folder (open it above).</p>
                  <p>
                    5. Open the extension and click{" "}
                    <span className="text-app-text-primary font-medium">
                      Send Session To Muxics
                    </span>
                    .
                  </p>
                  <p>6. Click Refresh above to confirm the connection.</p>
                </div>
              </details>

              {/* ── Extension ID ── */}
              {bridgeExtensionId && (
                <div className="text-[11px] text-app-text-tertiary break-all">
                  Extension ID: {bridgeExtensionId}
                </div>
              )}
            </div>
          </section>

          <div className="h-px bg-app-border" />

          {/* ── About ── */}
          <section>
            <SectionHeader
              icon={Info}
              title="About"
              desc="Application information and updates"
            />
            <div className="pl-11">
              <div className="flex items-center gap-4 p-4 bg-app-surface rounded-xl border border-app-border relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-app-accent/5 rounded-full blur-2xl -mr-10 -mt-10" />
                <div className="w-16 h-16 flex items-center justify-center shrink-0 drop-shadow-lg relative z-10">
                  <img
                    src={appIcon}
                    alt="Muxics"
                    className="w-[85%] h-[85%] object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0 relative z-10">
                  <h3 className="text-lg font-bold text-app-text-primary tracking-tight">
                    Muxics
                  </h3>
                  <div className="text-[13px] text-app-text-tertiary mt-0.5 flex items-center gap-2">
                    <span>Version {appVersion || "..."}</span>
                    <span className="w-1 h-1 rounded-full bg-app-border-strong" />
                    <button
                      onClick={handleCheckForUpdates}
                      disabled={
                        updateStatus === "checking" ||
                        updateStatus === "downloading"
                      }
                      className="text-app-accent hover:text-white transition-colors disabled:opacity-50"
                    >
                      {updateStatus === "checking"
                        ? "Checking..."
                        : updateStatus === "downloading"
                          ? "Downloading..."
                          : "Check for updates"}
                    </button>
                  </div>
                  <div className="text-[12px] text-app-text-tertiary mt-2">
                    Made by{" "}
                    <a
                      href="https://github.com/rajofearth"
                      target="_blank"
                      rel="noreferrer"
                      className="text-app-text-secondary hover:text-app-text-primary underline underline-offset-2 transition-colors"
                    >
                      Yashraj Maher
                    </a>
                  </div>
                  <div className="text-[12px] text-app-text-tertiary mt-1">
                    <a
                      href="https://github.com/rajofearth/muxics"
                      target="_blank"
                      rel="noreferrer"
                      className="text-app-text-secondary hover:text-app-text-primary transition-colors"
                    >
                      View source on GitHub
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
