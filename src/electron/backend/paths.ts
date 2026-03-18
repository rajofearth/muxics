import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DATA_ID, LEGACY_APP_DATA_IDS } from "../../shared/constants";

function getConfigRoot(): string {
  const home = os.homedir();

  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }

  return path.join(home, ".config");
}

function resolveAppDataPath(): string {
  const configRoot = getConfigRoot();

  for (const candidate of [APP_DATA_ID, ...LEGACY_APP_DATA_IDS]) {
    const candidatePath = path.join(configRoot, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return path.join(configRoot, APP_DATA_ID);
}

export const APP_DATA_PATH = resolveAppDataPath();
export const SETTINGS_PATH = path.join(APP_DATA_PATH, "settings.json");
export const PLAYLISTS_DIR = path.join(APP_DATA_PATH, "playlists");
export const YTMUSIC_DIR = path.join(APP_DATA_PATH, "ytmusic");
export const YTMUSIC_SESSION_PATH = path.join(YTMUSIC_DIR, "session.json");
export const YTMUSIC_CACHE_PATH = path.join(YTMUSIC_DIR, "cache.json");

export function getDefaultMusicPath(): string {
  const home = os.homedir();

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE ?? home;
    return path.join(userProfile, "Music");
  }

  return path.join(home, "Music");
}

export function ensureAppDataDirs(): void {
  if (!fs.existsSync(APP_DATA_PATH)) {
    fs.mkdirSync(APP_DATA_PATH, { recursive: true });
  }

  if (!fs.existsSync(PLAYLISTS_DIR)) {
    fs.mkdirSync(PLAYLISTS_DIR, { recursive: true });
  }

  if (!fs.existsSync(YTMUSIC_DIR)) {
    fs.mkdirSync(YTMUSIC_DIR, { recursive: true });
  }
}
