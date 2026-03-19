import fs from "node:fs";
import { SETTINGS_PATH, ensureAppDataDirs } from "./paths";

export interface Settings {
  watchFolders: string[];
  allowPlaintextYtMusicSession?: boolean;
  ytmusicCacheLimitBytes?: number;
}

const DEFAULT_SETTINGS: Settings = {
  watchFolders: [],
  allowPlaintextYtMusicSession: false,
  ytmusicCacheLimitBytes: 1024 * 1024 * 1024,
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
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  ensureAppDataDirs();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
