import { contextBridge, ipcRenderer } from "electron";
import type {
  AutoUpdateStatus,
  DesktopBridge,
  DesktopEventMap,
} from "../shared/desktop-contract";
import {
  BENCH_FLUSH_CHANNEL_V1,
  BENCH_RECORD_CHANNEL_V1,
  type BenchIpcRecord,
  type BenchRecord,
} from "../shared/bench-contract";

type RendererEventPayload = {
  [K in keyof DesktopEventMap]: { channel: K; payload: DesktopEventMap[K] };
}[keyof DesktopEventMap];

// Benchmark instrumentation (issue #39), gated by MUXICS_BENCH=1. Zero
// overhead when off: timedRequest returns the raw invoke untouched and the
// request object is not wrapped at all.
const BENCH_ENABLED = process.env["MUXICS_BENCH"] === "1";

// ── Batched transport (design §2.3.6) ─────────────────────────────────────
// All records (timed IPC + renderer marks/measures) accumulate in one buffer
// and ship to main every ~100ms plus an explicit final flush. Durations are
// captured at wrap time, so batching only changes when records *arrive* at
// main, never the numbers themselves.
const benchBatch: BenchRecord[] = [];
const benchSeqByIpcName = new Map<string, number>();

function benchSendBatch(): void {
  if (benchBatch.length === 0) return;
  const batch = benchBatch.splice(0);
  ipcRenderer.send(BENCH_RECORD_CHANNEL_V1, batch);
}

if (BENCH_ENABLED) {
  setInterval(benchSendBatch, 100);
}

function benchRecord(record: BenchRecord): void {
  if (!BENCH_ENABLED) return;
  benchBatch.push(record);
}

function benchFlush(): Promise<unknown> {
  if (!BENCH_ENABLED) return Promise.resolve(null);
  benchSendBatch();
  return ipcRenderer.invoke(BENCH_FLUSH_CHANNEL_V1);
}

function timedRequest<T>(name: string, invoke: () => Promise<T>): Promise<T> {
  if (!BENCH_ENABLED) return invoke();
  const start = performance.now();
  const finished = () => {
    const seq = (benchSeqByIpcName.get(name) ?? 0) + 1;
    benchSeqByIpcName.set(name, seq);
    benchRecord({
      kind: "ipc",
      name,
      seq,
      // Monotonic epoch ms — correlates with main-process stdout and
      // driver-side wall-clock (design §2.3.1).
      start: performance.timeOrigin + start,
      duration: performance.now() - start,
    } satisfies BenchIpcRecord);
  };
  return invoke().then(
    (result) => {
      finished();
      return result;
    },
    (error) => {
      finished();
      throw error;
    },
  );
}

// Wrap the whole request map once instead of touching ~40 call sites: any
// future desktop:request method is timed automatically. Callers see the same
// promises, same values, same rejection behavior.
function wrapTimedRequest(
  request: DesktopBridge["request"],
): DesktopBridge["request"] {
  if (!BENCH_ENABLED) return request;
  const wrapped: Record<string, (...args: never[]) => Promise<unknown>> = {};
  for (const [name, method] of Object.entries(request) as [
    string,
    (...args: never[]) => Promise<unknown>,
  ][]) {
    wrapped[name] = (...args: never[]) =>
      timedRequest(`desktop:request:${name}`, () => method(...args));
  }
  return wrapped as unknown as DesktopBridge["request"];
}

const desktopBridge: DesktopBridge = {
  request: wrapTimedRequest({
    getDefaultMusicPath: () =>
      ipcRenderer.invoke("desktop:request:getDefaultMusicPath"),
    scanFolders: (params) =>
      ipcRenderer.invoke("desktop:request:scanFolders", params),
    getTrackMetadata: (params) =>
      ipcRenderer.invoke("desktop:request:getTrackMetadata", params),
    getPlaybackUrl: (params) =>
      ipcRenderer.invoke("desktop:request:getPlaybackUrl", params),
    getWatchFolders: () =>
      ipcRenderer.invoke("desktop:request:getWatchFolders"),
    getSettings: () =>
      ipcRenderer.invoke("desktop:request:getSettings"),
    saveSettings: (params) =>
      ipcRenderer.invoke("desktop:request:saveSettings", params),
    getYtMusicCacheStats: () =>
      ipcRenderer.invoke("desktop:request:getYtMusicCacheStats"),
    getFullyCachedTrackIds: () =>
      ipcRenderer.invoke("desktop:request:getFullyCachedTrackIds"),
    clearYtMusicCache: () =>
      ipcRenderer.invoke("desktop:request:clearYtMusicCache"),
    clearYtMusicMetadataCache: () =>
      ipcRenderer.invoke("desktop:request:clearYtMusicMetadataCache"),
    addFolder: (params) =>
      ipcRenderer.invoke("desktop:request:addFolder", params),
    validateFolder: (params) =>
      ipcRenderer.invoke("desktop:request:validateFolder", params),
    removeFolder: (params) =>
      ipcRenderer.invoke("desktop:request:removeFolder", params),
    loadPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:loadPlaylist", params),
    savePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:savePlaylist", params),
    listPlaylists: () => ipcRenderer.invoke("desktop:request:listPlaylists"),
    getPlaylistsDir: () =>
      ipcRenderer.invoke("desktop:request:getPlaylistsDir"),
    renamePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:renamePlaylist", params),
    deletePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:deletePlaylist", params),
    importPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:importPlaylist", params),
    exportPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:exportPlaylist", params),
    getPlatform: () => ipcRenderer.invoke("desktop:request:getPlatform"),
    authGetStatus: () => ipcRenderer.invoke("desktop:request:authGetStatus"),
    authImportSession: (params) =>
      ipcRenderer.invoke("desktop:request:authImportSession", params),
    authLogout: () => ipcRenderer.invoke("desktop:request:authLogout"),
    openExternalUrl: (params) =>
      ipcRenderer.invoke("desktop:request:openExternalUrl", params),
    prepareBrowserBridge: () =>
      ipcRenderer.invoke("desktop:request:prepareBrowserBridge"),
    installBrowserBridgeHost: () =>
      ipcRenderer.invoke("desktop:request:installBrowserBridgeHost"),
    openPath: (params) =>
      ipcRenderer.invoke("desktop:request:openPath", params),
    ytmusicSyncLibrary: () =>
      ipcRenderer.invoke("desktop:request:ytmusicSyncLibrary"),
    ytmusicLoadCachedLibrary: () =>
      ipcRenderer.invoke("desktop:request:ytmusicLoadCachedLibrary"),
    ytmusicSearch: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicSearch", params),
    ytmusicGetHomeFeed: () =>
      ipcRenderer.invoke("desktop:request:ytmusicGetHomeFeed"),
    ytmusicGetPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicGetPlaylist", params),
    ytmusicGetPlayback: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicGetPlayback", params),
    ytmusicLike: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicLike", params),
    ytmusicUnlike: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicUnlike", params),
    ytmusicCreatePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicCreatePlaylist", params),
    ytmusicRenamePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicRenamePlaylist", params),
    ytmusicDeletePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicDeletePlaylist", params),
    ytmusicAddTrackToPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicAddTrackToPlaylist", params),
    ytmusicRemoveTrackFromPlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicRemoveTrackFromPlaylist", params),
    ytmusicSavePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicSavePlaylist", params),
    ytmusicUnsavePlaylist: (params) =>
      ipcRenderer.invoke("desktop:request:ytmusicUnsavePlaylist", params),
    getAppVersion: () =>
      ipcRenderer.invoke("desktop:request:getAppVersion"),
    checkForUpdates: () =>
      ipcRenderer.invoke("desktop:request:checkForUpdates"),
    installUpdate: () =>
      ipcRenderer.invoke("desktop:request:installUpdate"),
  }),
  send: {
    resizeWindow: (payload) =>
      ipcRenderer.send("desktop:message:resizeWindow", payload),
    setMinSize: (payload) =>
      ipcRenderer.send("desktop:message:setMinSize", payload),
    closeWindow: () => ipcRenderer.send("desktop:message:closeWindow"),
    minimizeWindow: () => ipcRenderer.send("desktop:message:minimizeWindow"),
    maximizeWindow: () => ipcRenderer.send("desktop:message:maximizeWindow"),
    showContextMenu: () => ipcRenderer.send("desktop:message:showContextMenu"),
    updateNowPlaying: (payload) =>
      ipcRenderer.send("desktop:message:updateNowPlaying", payload),
    clearNowPlaying: () => ipcRenderer.send("desktop:message:clearNowPlaying"),
  },
  // Benchmark instrumentation bridge — records go into the batch buffer;
  // flush() ships the pending batch first, then asks main to write the trace.
  bench: {
    enabled: BENCH_ENABLED,
    record: benchRecord,
    flush: benchFlush,
  },
};

function dispatchMenuOrContextEvent(
  channel: "contextMenuAction" | "menuAction",
  payload: DesktopEventMap[typeof channel],
) {
  const eventName =
    channel === "contextMenuAction"
      ? "winamp-context-action"
      : "winamp-menu-action";
  document.dispatchEvent(
    new CustomEvent(eventName, { detail: payload.action }),
  );
}

ipcRenderer.on("desktop:event", (_event, message: RendererEventPayload) => {
  if (message.channel === "ytmusicCacheStatsUpdated") {
    document.dispatchEvent(
      new CustomEvent("muxics-yt-cache-stats", { detail: message.payload }),
    );
    return;
  }
  if (message.channel === "autoUpdateStatus") {
    document.dispatchEvent(
      new CustomEvent<AutoUpdateStatus>("muxics-auto-update", { detail: message.payload }),
    );
    return;
  }
  if (message.channel === "contextMenuAction" || message.channel === "menuAction") {
    dispatchMenuOrContextEvent(message.channel, message.payload);
  }
});

contextBridge.exposeInMainWorld("muxicsDesktop", desktopBridge);
