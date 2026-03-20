import { useEffect, useMemo, useState } from "react";
import type { CacheStatsResult, DesktopBridge, DesktopSettings } from "../../shared/desktop-contract";
import { showToast } from "./Toast";

type SettingsViewProps = {
  desktop?: DesktopBridge;
};

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return `${Math.round(value / (1024 * 1024))} MB`;
}

const POLL_MS = 2000;

export function SettingsView({ desktop }: SettingsViewProps) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [usageBytes, setUsageBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const limitGb = useMemo(
    () => Math.max(1, Math.round((settings?.ytmusicCacheLimitBytes ?? 1024 ** 3) / (1024 * 1024 * 1024))),
    [settings?.ytmusicCacheLimitBytes],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!desktop) {
        return;
      }

      const [nextSettings, stats] = await Promise.all([
        desktop.request.getSettings(),
        desktop.request.getYtMusicCacheStats(),
      ]);

      if (cancelled) {
        return;
      }

      setSettings(nextSettings);
      setUsageBytes(stats.usageBytes);
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
      if (detail?.usageBytes != null) {
        setUsageBytes(detail.usageBytes);
      }
    };
    document.addEventListener("muxics-yt-cache-stats", onStats);

    const id = setInterval(() => {
      void (async () => {
        const stats = await desktop.request.getYtMusicCacheStats();
        setUsageBytes(stats.usageBytes);
      })();
    }, POLL_MS);

    return () => {
      document.removeEventListener("muxics-yt-cache-stats", onStats);
      clearInterval(id);
    };
  }, [desktop]);

  const persistPartial = async (partial: Partial<DesktopSettings>) => {
    if (!desktop || !settings) return;
    const next = { ...settings, ...partial };
    setSettings(next);
    await desktop.request.saveSettings(partial);
    const stats = await desktop.request.getYtMusicCacheStats();
    setUsageBytes(stats.usageBytes);
  };

  const saveLimit = async (nextGb: number) => {
    if (!desktop || !settings) return;
    const nextBytes = nextGb * 1024 * 1024 * 1024;
    await persistPartial({ ytmusicCacheLimitBytes: nextBytes });
    showToast("Cache size updated.");
  };

  const clearMediaCache = async () => {
    if (!desktop) return;
    await desktop.request.clearYtMusicCache();
    const stats = await desktop.request.getYtMusicCacheStats();
    setUsageBytes(stats.usageBytes);
    showToast("Media cache cleared.");
  };

  const clearMetadataCache = async () => {
    if (!desktop) return;
    await desktop.request.clearYtMusicMetadataCache();
    showToast("Library and search cache cleared.");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-1">Settings</div>
        <h1 className="text-3xl font-bold text-app-text-primary tracking-tight mb-1">Playback &amp; cache</h1>
        <p className="text-[13px] text-app-text-secondary">
          Disk usage for YouTube Music streams and optional metadata caches.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-8">
        <section>
          <div className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider mb-3">
            Media cache
          </div>
          <div className="p-5 bg-app-surface rounded-xl border border-app-border space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-app-text-primary">Size limit</div>
                <p className="mt-1 text-[12px] text-app-text-tertiary max-w-xl">
                  Oldest cached audio and artwork are removed when usage exceeds this budget.
                </p>
              </div>
              <div className="text-[12px] text-app-text-secondary tabular-nums shrink-0">
                {loading ? "…" : `${formatBytes(usageBytes)} used`}
              </div>
            </div>

            <div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={limitGb}
                onChange={(event) => void saveLimit(Number(event.target.value))}
                disabled={loading || !settings}
                className="w-full accent-app-accent"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-app-text-tertiary">
                <span>1 GB</span>
                <span>{limitGb} GB limit</span>
                <span>10 GB</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-app-border">
              <p className="text-[12px] text-app-text-tertiary">Signed-in account is not affected.</p>
              <button
                type="button"
                onClick={() => void clearMediaCache()}
                className="px-4 py-2 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary font-medium border border-app-border"
              >
                Clear media
              </button>
            </div>
          </div>
        </section>

        <section>
          <div className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider mb-3">
            Library &amp; search data
          </div>
          <p className="text-[12px] text-app-text-secondary mb-4 max-w-2xl">
            Stored separately from media. Turning these off forces fresh fetches (slower cold start).
          </p>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 px-4 py-3 bg-app-surface rounded-xl border border-app-border text-[13px] text-app-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 accent-app-accent"
                checked={settings?.ytmusicUseLibraryDiskCache !== false}
                disabled={loading || !settings}
                onChange={(e) => void persistPartial({ ytmusicUseLibraryDiskCache: e.target.checked })}
              />
              <span>
                <span className="font-medium text-app-text-primary block">Load library from disk on startup</span>
                <span className="text-[12px] text-app-text-tertiary">
                  Show playlists and last-synced tracks immediately, then refresh in the background.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 px-4 py-3 bg-app-surface rounded-xl border border-app-border text-[13px] text-app-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 accent-app-accent"
                checked={settings?.ytmusicHomeSnapshotEnabled !== false}
                disabled={loading || !settings}
                onChange={(e) => void persistPartial({ ytmusicHomeSnapshotEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium text-app-text-primary block">Save home feed snapshot</span>
                <span className="text-[12px] text-app-text-tertiary">
                  After each successful library sync, refresh a small on-disk copy of the YT Music home feed.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 px-4 py-3 bg-app-surface rounded-xl border border-app-border text-[13px] text-app-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 accent-app-accent"
                checked={settings?.ytmusicSearchCacheEnabled !== false}
                disabled={loading || !settings}
                onChange={(e) => void persistPartial({ ytmusicSearchCacheEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium text-app-text-primary block">Cache search results</span>
                <span className="text-[12px] text-app-text-tertiary">
                  Reuse recent queries within the TTL below. Cleared on sign-out or new session import.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="px-4 py-3 bg-app-surface rounded-xl border border-app-border">
              <label className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider block mb-2">
                Search cache TTL
              </label>
              <select
                className="w-full px-3 py-2 bg-app-bg border border-app-border rounded-lg text-[13px] text-app-text-primary outline-none focus:border-app-text-tertiary"
                value={settings?.ytmusicSearchCacheTtlMinutes ?? 30}
                disabled={loading || !settings}
                onChange={(e) => void persistPartial({ ytmusicSearchCacheTtlMinutes: Number(e.target.value) })}
              >
                {[15, 30, 60, 120, 240, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>
            <div className="px-4 py-3 bg-app-surface rounded-xl border border-app-border">
              <label className="text-[11px] text-app-text-tertiary font-medium uppercase tracking-wider block mb-2">
                Search cache max entries
              </label>
              <select
                className="w-full px-3 py-2 bg-app-bg border border-app-border rounded-lg text-[13px] text-app-text-primary outline-none focus:border-app-text-tertiary"
                value={settings?.ytmusicSearchCacheMaxEntries ?? 100}
                disabled={loading || !settings}
                onChange={(e) => void persistPartial({ ytmusicSearchCacheMaxEntries: Number(e.target.value) })}
              >
                {[25, 50, 100, 200, 500].map((n) => (
                  <option key={n} value={n}>
                    {n} queries
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-app-surface rounded-xl border border-app-border">
            <p className="text-[12px] text-app-text-tertiary max-w-xl">
              Clear saved library JSON, home snapshot, and search cache. Does not remove media files or sign you out.
            </p>
            <button
              type="button"
              onClick={() => void clearMetadataCache()}
              className="px-4 py-2 bg-app-elevated hover:bg-app-active rounded-lg text-[13px] text-app-text-primary font-medium border border-app-border shrink-0"
            >
              Clear metadata
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
