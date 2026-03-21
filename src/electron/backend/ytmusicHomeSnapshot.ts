import fs from "node:fs";
import type { TrackResult, YTMusicHomeResult } from "../../shared/desktop-contract";
import { ensureAppDataDirs, YTMUSIC_HOME_SNAPSHOT_PATH } from "./paths";
import { loadSettings } from "./settings";

function readHomeSnapshotFromDisk(): YTMusicHomeResult | null {
  ensureAppDataDirs();
  try {
    const raw = fs.readFileSync(YTMUSIC_HOME_SNAPSHOT_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { tracks?: TrackResult[] };
    if (!Array.isArray(parsed.tracks)) {
      return null;
    }
    return { tracks: parsed.tracks };
  } catch {
    return null;
  }
}

export function writeHomeSnapshotToDisk(result: YTMusicHomeResult): void {
  ensureAppDataDirs();
  try {
    fs.writeFileSync(YTMUSIC_HOME_SNAPSHOT_PATH, JSON.stringify(result, null, 2), "utf-8");
  } catch (error) {
    console.error("[muxics:ytmusic] Failed to write home snapshot to", YTMUSIC_HOME_SNAPSHOT_PATH, error);
  }
}

export function getYtMusicHomeSnapshot(): YTMusicHomeResult | null {
  if (loadSettings().ytmusicHomeSnapshotEnabled === false) {
    return null;
  }
  return readHomeSnapshotFromDisk();
}
