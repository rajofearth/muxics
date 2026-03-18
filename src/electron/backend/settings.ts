import fs from "node:fs";
import { SETTINGS_PATH, ensureAppDataDirs } from "./paths";

export interface Settings {
  watchFolders: string[];
  allowPlaintextYtMusicSession?: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  watchFolders: [],
  allowPlaintextYtMusicSession: false,
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
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  ensureAppDataDirs();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
