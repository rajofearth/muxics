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
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-app-text-tertiary">Settings</div>
          <h1 className="mt-2 text-[28px] font-semibold text-app-text-primary">Playback and cache</h1>
          <p className="mt-2 text-[13px] text-app-text-secondary">
            Control disk usage, offline-friendly library data, and YouTube Music home/search caching.
          </p>
        </div>

        <section className="rounded-3xl border border-app-border bg-app-surface-alt/80 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-medium text-app-text-primary">YT media cache size</h2>
              <p className="mt-1 text-[12px] text-app-text-tertiary">
                Budget for cached audio and artwork. Oldest entries are removed when you exceed the limit.
              </p>
            </div>
            <div className="rounded-xl border border-app-border bg-app-elevated px-3 py-2 text-[12px] text-app-text-secondary">
              {loading ? "Loading..." : `${formatBytes(usageBytes)} used`}
            </div>
          </div>

          <div className="mt-5">
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
            <div className="mt-2 flex items-center justify-between text-[12px] text-app-text-tertiary">
              <span>1 GB</span>
              <span>{limitGb} GB limit</span>
              <span>10 GB</span>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-app-border bg-app-elevated/70 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-app-text-primary">Clear media cache</div>
              <div className="text-[12px] text-app-text-tertiary">
                Removes cached audio and artwork files. Your account stays connected.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void clearMediaCache()}
              className="rounded-xl border border-app-border px-3 py-2 text-[12px] font-medium text-app-text-primary hover:bg-app-active"
            >
              Clear media
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-app-border bg-app-surface-alt/80 p-6 space-y-4">
          <h2 className="text-[16px] font-medium text-app-text-primary">Library and search data</h2>
          <p className="text-[12px] text-app-text-tertiary">
            Metadata is stored separately from media bytes. Disable options to always fetch fresh data (slower cold
            start).
          </p>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] text-app-text-secondary">
            <input
              type="checkbox"
              className="mt-0.5 accent-app-accent"
              checked={settings?.ytmusicUseLibraryDiskCache !== false}
              disabled={loading || !settings}
              onChange={(e) => void persistPartial({ ytmusicUseLibraryDiskCache: e.target.checked })}
            />
            <span>
              <span className="font-medium text-app-text-primary">Load library from disk on startup</span>
              <span className="mt-0.5 block text-[12px] text-app-text-tertiary">
                Show playlist names and last-synced tracks immediately, then refresh in the background.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] text-app-text-secondary">
            <input
              type="checkbox"
              className="mt-0.5 accent-app-accent"
              checked={settings?.ytmusicHomeSnapshotEnabled !== false}
              disabled={loading || !settings}
              onChange={(e) => void persistPartial({ ytmusicHomeSnapshotEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium text-app-text-primary">Save home feed snapshot</span>
              <span className="mt-0.5 block text-[12px] text-app-text-tertiary">
                Remember the last home recommendations for instant display while the feed reloads.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] text-app-text-secondary">
            <input
              type="checkbox"
              className="mt-0.5 accent-app-accent"
              checked={settings?.ytmusicSearchCacheEnabled !== false}
              disabled={loading || !settings}
              onChange={(e) => void persistPartial({ ytmusicSearchCacheEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium text-app-text-primary">Cache search results</span>
              <span className="mt-0.5 block text-[12px] text-app-text-tertiary">
                Reuse recent queries within the TTL below (per-session invalidation on sign-out / new import).
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-[12px] font-medium text-app-text-primary">Search cache TTL</label>
              <select
                className="mt-1 w-full rounded-xl border border-app-border bg-app-elevated px-3 py-2 text-[13px] text-app-text-primary"
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
            <div>
              <label className="text-[12px] font-medium text-app-text-primary">Search cache max entries</label>
              <select
                className="mt-1 w-full rounded-xl border border-app-border bg-app-elevated px-3 py-2 text-[13px] text-app-text-primary"
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

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-app-border bg-app-elevated/70 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-app-text-primary">Clear library &amp; search cache</div>
              <div className="text-[12px] text-app-text-tertiary">
                Removes saved library JSON, home snapshot, and search cache. Does not remove media files or sign you
                out.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void clearMetadataCache()}
              className="rounded-xl border border-app-border px-3 py-2 text-[12px] font-medium text-app-text-primary hover:bg-app-active"
            >
              Clear metadata
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
