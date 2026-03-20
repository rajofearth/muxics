import fs from "node:fs";
import { SETTINGS_PATH, ensureAppDataDirs } from "./paths";

export interface Settings {
  watchFolders: string[];
  allowPlaintextYtMusicSession?: boolean;
  ytmusicCacheLimitBytes?: number;
  /** When true, startup hydrates library/playlists from disk before network sync. */
  ytmusicUseLibraryDiskCache?: boolean;
  /** Persist last home feed for instant cold display. */
  ytmusicHomeSnapshotEnabled?: boolean;
  ytmusicSearchCacheEnabled?: boolean;
  ytmusicSearchCacheTtlMinutes?: number;
  ytmusicSearchCacheMaxEntries?: number;
}

const DEFAULT_SETTINGS: Settings = {
  watchFolders: [],
  allowPlaintextYtMusicSession: false,
  ytmusicCacheLimitBytes: 1024 * 1024 * 1024,
  ytmusicUseLibraryDiskCache: true,
  ytmusicHomeSnapshotEnabled: true,
  ytmusicSearchCacheEnabled: true,
  ytmusicSearchCacheTtlMinutes: 30,
  ytmusicSearchCacheMaxEntries: 100,
};

export function loadSettings(): Settings {
  ensureAppDataDirs();

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;

    return {
      watchFolders: Array.isArray(parsed.watchFolders)
        ? parsed.watchFolders
        : DEFAULT_SETTINGS.watchFolders,
      allowPlaintextYtMusicSession:
        typeof parsed.allowPlaintextYtMusicSession === "boolean"
          ? parsed.allowPlaintextYtMusicSession
          : DEFAULT_SETTINGS.allowPlaintextYtMusicSession,
      ytmusicCacheLimitBytes:
        typeof parsed.ytmusicCacheLimitBytes === "number" && parsed.ytmusicCacheLimitBytes > 0
          ? parsed.ytmusicCacheLimitBytes
          : DEFAULT_SETTINGS.ytmusicCacheLimitBytes,
      ytmusicUseLibraryDiskCache:
        typeof parsed.ytmusicUseLibraryDiskCache === "boolean"
          ? parsed.ytmusicUseLibraryDiskCache
          : DEFAULT_SETTINGS.ytmusicUseLibraryDiskCache,
      ytmusicHomeSnapshotEnabled:
        typeof parsed.ytmusicHomeSnapshotEnabled === "boolean"
          ? parsed.ytmusicHomeSnapshotEnabled
          : DEFAULT_SETTINGS.ytmusicHomeSnapshotEnabled,
      ytmusicSearchCacheEnabled:
        typeof parsed.ytmusicSearchCacheEnabled === "boolean"
          ? parsed.ytmusicSearchCacheEnabled
          : DEFAULT_SETTINGS.ytmusicSearchCacheEnabled,
      ytmusicSearchCacheTtlMinutes:
        typeof parsed.ytmusicSearchCacheTtlMinutes === "number" &&
        parsed.ytmusicSearchCacheTtlMinutes > 0
          ? parsed.ytmusicSearchCacheTtlMinutes
          : DEFAULT_SETTINGS.ytmusicSearchCacheTtlMinutes,
      ytmusicSearchCacheMaxEntries:
        typeof parsed.ytmusicSearchCacheMaxEntries === "number" &&
        parsed.ytmusicSearchCacheMaxEntries > 0
          ? parsed.ytmusicSearchCacheMaxEntries
          : DEFAULT_SETTINGS.ytmusicSearchCacheMaxEntries,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  ensureAppDataDirs();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
