import path from "path";
import os from "os";
import fs from "fs";

const APP_ID = "muse.electrobun.dev";

function getAppDataPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, APP_ID);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_ID);
  }
  return path.join(home, ".config", APP_ID);
}

export const APP_DATA_PATH = getAppDataPath();

export const SETTINGS_PATH = path.join(APP_DATA_PATH, "settings.json");
export const PLAYLISTS_DIR = path.join(APP_DATA_PATH, "playlists");

export function getDefaultMusicPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
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
}
