import { useEffect, useMemo, useState } from "react";
import type { DesktopBridge } from "../../shared/desktop-contract";
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

export function SettingsView({ desktop }: SettingsViewProps) {
  const [limitBytes, setLimitBytes] = useState(1024 * 1024 * 1024);
  const [usageBytes, setUsageBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const limitGb = useMemo(() => Math.max(1, Math.round(limitBytes / (1024 * 1024 * 1024))), [limitBytes]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!desktop) {
        return;
      }

      const [settings, stats] = await Promise.all([
        desktop.request.getSettings(),
        desktop.request.getYtMusicCacheStats(),
      ]);

      if (cancelled) {
        return;
      }

      setLimitBytes(settings.ytmusicCacheLimitBytes);
      setUsageBytes(stats.usageBytes);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const saveLimit = async (nextGb: number) => {
    if (!desktop) return;

    const nextBytes = nextGb * 1024 * 1024 * 1024;
    setLimitBytes(nextBytes);
    await desktop.request.saveSettings({ ytmusicCacheLimitBytes: nextBytes });
    const stats = await desktop.request.getYtMusicCacheStats();
    setUsageBytes(stats.usageBytes);
    showToast("Cache size updated.");
  };

  const clearCache = async () => {
    if (!desktop) return;

    await desktop.request.clearYtMusicCache();
    const stats = await desktop.request.getYtMusicCacheStats();
    setUsageBytes(stats.usageBytes);
    showToast("YT cache cleared.");
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-app-text-tertiary">Settings</div>
          <h1 className="mt-2 text-[28px] font-semibold text-app-text-primary">Playback and cache</h1>
          <p className="mt-2 text-[13px] text-app-text-secondary">
            Control how much disk space YouTube Music can use for faster playback, artwork, and playlist data.
          </p>
        </div>

        <section className="rounded-3xl border border-app-border bg-app-surface-alt/80 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-medium text-app-text-primary">YT cache size</h2>
              <p className="mt-1 text-[12px] text-app-text-tertiary">
                Default is 1 GB. Increase it if you want more repeat plays and faster playlist loads.
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
              <div className="text-[13px] font-medium text-app-text-primary">Clear YT cache</div>
              <div className="text-[12px] text-app-text-tertiary">
                Removes cached audio, images, and hydrated playlist data. Your account stays connected.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void clearCache()}
              className="rounded-xl border border-app-border px-3 py-2 text-[12px] font-medium text-app-text-primary hover:bg-app-active"
            >
              Clear cache
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
