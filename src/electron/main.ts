import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import type {
  DesktopEventMap,
  DesktopMessageMap,
  DesktopRequestMap,
  DesktopSettings,
} from "../shared/desktop-contract";
import { APP_ID, APP_NAME } from "../shared/constants";
import { getDefaultMusicPath, PLAYLISTS_DIR } from "./backend/paths";
import { scanFolders } from "./backend/scanner";
import { formatMetadataTime, getTrackMetadata } from "./backend/metadata";
import { getAudioServerPort, setAllowedPaths, startAudioServer } from "./backend/audioServer";
import { clearYtMusicCache, getYtMusicCacheStats, getFullyCachedTrackIds } from "./backend/ytMusicCache";
import { setYtMusicCacheStatsListener } from "./backend/rendererNotify";
import { getCachedYtMusicSearch, setCachedYtMusicSearch } from "./backend/ytmusicSearchCache";
import { listPlaylists, loadPlaylist, savePlaylist } from "./backend/playlists";
import { loadSettings, saveSettings } from "./backend/settings";
import { installBrowserBridgeHost, prepareBrowserBridgeBundle } from "./backend/browserBridge";
import { runNativeMessagingHost } from "./backend/nativeHost";
import {
  addTrackToYtMusicPlaylist,
  createYtMusicPlaylist,
  deleteYtMusicPlaylist,
  clearYtMusicMetadataCache,
  getCachedYtMusicLibrary,
  getYtMusicAuthStatus,
  getYtMusicPlayback,
  getYtMusicPlaylist,
  importYtMusicSession,
  likeYtMusicTrack,
  loginToYtMusic,
  completeYtMusicLogin,
  cancelYtMusicLogin,
  logoutFromYtMusic,
  removeTrackFromYtMusicPlaylist,
  renameYtMusicPlaylist,
  searchYtMusic,
  syncYtMusicLibrary,
  unlikeYtMusicTrack,
} from "./backend/ytmusic";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentMinWidth = 800;
let currentMinHeight = 600;
let currentTrackTitle = "";
let currentTrackArtist = "";
let isPlaying = false;

if (process.argv.includes("--muxics-native-host")) {
  runNativeMessagingHost();
} else {

process.on("unhandledRejection", (reason) => {
  console.error("[muxics:main] Unhandled rejection:", reason);
});

type RequestHandlerMap = {
  [K in keyof DesktopRequestMap]: (
    params: DesktopRequestMap[K]["params"]
  ) => Promise<DesktopRequestMap[K]["response"]> | DesktopRequestMap[K]["response"];
};

type MessageHandlerMap = {
  [K in keyof DesktopMessageMap]: DesktopMessageMap[K] extends void
    ? () => void
    : (payload: DesktopMessageMap[K]) => void;
};

function getRendererEntry(): string | null {
  const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
  if (devServerUrl) {
    return devServerUrl;
  }

  return null;
}

function isMissingUpdateMetadataError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.message}\n${error.stack ?? ""}`;
  return /latest(?:-[\w.-]+)?\.yml/i.test(message) && /(404|not found|cannot find)/i.test(message);
}

function handleUpdateCheckError(error: unknown) {
  if (isMissingUpdateMetadataError(error)) {
    return;
  }

  console.error("[muxics:updater] Update check failed:", error);
  sendRendererEvent("autoUpdateStatus", { status: "error", message: error instanceof Error ? error.message : "Update error" });
}

function getAssetPath(...segments: string[]): string {
  return path.join(app.getAppPath(), ...segments);
}

function getWindowIconPath(): string | undefined {
  if (process.platform === "win32") {
    const iconPath = getAssetPath("assets", "icon.ico");
    return fs.existsSync(iconPath) ? iconPath : undefined;
  }

  if (process.platform === "linux") {
    const iconPath = getAssetPath("icon.iconset", "icon_512x512.png");
    return fs.existsSync(iconPath) ? iconPath : undefined;
  }

  return undefined;
}

function getTrayImage() {
  const candidates =
    process.platform === "win32"
      ? [getAssetPath("assets", "icon.ico")]
      : [
          getAssetPath("icon.iconset", "icon_32x32.png"),
          getAssetPath("icon.iconset", "icon_16x16@2x.png"),
          getAssetPath("icon.iconset", "icon_32x32@2x.png"),
        ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) {
        return image;
      }
    }
  }

  return null;
}

function sendRendererEvent<K extends keyof DesktopEventMap>(channel: K, payload: DesktopEventMap[K]) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("desktop:event", { channel, payload });
}

function buildDesktopSettings(): DesktopSettings {
  const settings = loadSettings();
  return {
    ytmusicCacheLimitBytes: settings.ytmusicCacheLimitBytes ?? 1024 * 1024 * 1024,
    ytmusicUseLibraryDiskCache: settings.ytmusicUseLibraryDiskCache !== false,
    ytmusicHomeSnapshotEnabled: settings.ytmusicHomeSnapshotEnabled !== false,
    ytmusicSearchCacheEnabled: settings.ytmusicSearchCacheEnabled !== false,
    ytmusicSearchCacheTtlMinutes: settings.ytmusicSearchCacheTtlMinutes ?? 30,
    ytmusicSearchCacheMaxEntries: settings.ytmusicSearchCacheMaxEntries ?? 100,
    ytmusicLibrarySyncDebug: settings.ytmusicLibrarySyncDebug === true,
  };
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (currentTrackTitle) {
    mainWindow.setTitle(`${currentTrackTitle} - ${currentTrackArtist}`);
  } else {
    mainWindow.setTitle(APP_NAME);
  }
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const items: MenuItemConstructorOptions[] = [];

  if (currentTrackTitle) {
    items.push(
      { label: currentTrackTitle, enabled: false },
      { label: currentTrackArtist, enabled: false },
      { type: "separator" }
    );
  }

  items.push(
    { label: isPlaying ? "Pause" : "Play", click: () => sendRendererEvent("contextMenuAction", { action: "playPause" }) },
    { label: "Next Track", click: () => sendRendererEvent("contextMenuAction", { action: "next" }) },
    { label: "Previous Track", click: () => sendRendererEvent("contextMenuAction", { action: "prev" }) },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        if (!mainWindow) {
          return;
        }
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(currentTrackTitle ? `${APP_NAME}: ${currentTrackTitle}` : APP_NAME);
}

function setupTray() {
  try {
    const trayImage = getTrayImage();
    if (!trayImage) {
      return;
    }

    tray = new Tray(trayImage);
    tray.on("click", () => {
      if (!mainWindow) {
        return;
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    });

    updateTrayMenu();
  } catch (error) {
    console.warn("Tray not available on this platform:", error);
  }
}

function createApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    ...(process.platform === "darwin"
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Playback",
      submenu: [
        {
          label: "Play / Pause",
          accelerator: "Space",
          click: () => sendRendererEvent("menuAction", { action: "playPause" }),
        },
        {
          label: "Next Track",
          accelerator: "CmdOrCtrl+Right",
          click: () => sendRendererEvent("menuAction", { action: "next" }),
        },
        {
          label: "Previous Track",
          accelerator: "CmdOrCtrl+Left",
          click: () => sendRendererEvent("menuAction", { action: "prev" }),
        },
        { type: "separator" },
        {
          label: "Volume Up",
          accelerator: "CmdOrCtrl+Up",
          click: () => sendRendererEvent("menuAction", { action: "volumeUp" }),
        },
        {
          label: "Volume Down",
          accelerator: "CmdOrCtrl+Down",
          click: () => sendRendererEvent("menuAction", { action: "volumeDown" }),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Library",
          accelerator: "CmdOrCtrl+L",
          click: () => sendRendererEvent("menuAction", { action: "viewLibrary" }),
        },
        {
          label: "Now Playing",
          accelerator: "CmdOrCtrl+N",
          click: () => sendRendererEvent("menuAction", { action: "viewNowPlaying" }),
        },
        {
          label: "Search",
          accelerator: "CmdOrCtrl+F",
          click: () => sendRendererEvent("menuAction", { action: "viewSearch" }),
        },
        { type: "separator" },
        {
          label: "Mini Player",
          click: () => sendRendererEvent("menuAction", { action: "viewMini" }),
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(process.platform === "darwin" ? [{ role: "front" as const }] : [])],
    },
  ]);

  Menu.setApplicationMenu(menu);

  if (mainWindow && process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.autoHideMenuBar = true;
  }
}

function buildContextMenu() {
  const items: MenuItemConstructorOptions[] = [];

  if (currentTrackTitle) {
    items.push(
      { label: `♪ ${currentTrackTitle}`, enabled: false },
      { label: `  ${currentTrackArtist}`, enabled: false },
      { type: "separator" }
    );
  }

  items.push(
    {
      label: isPlaying ? "Pause" : "Play",
      accelerator: "Space",
      click: () => sendRendererEvent("contextMenuAction", { action: "playPause" }),
    },
    {
      label: "Previous Track",
      accelerator: "Left",
      click: () => sendRendererEvent("contextMenuAction", { action: "prev" }),
    },
    {
      label: "Next Track",
      accelerator: "Right",
      click: () => sendRendererEvent("contextMenuAction", { action: "next" }),
    },
    { type: "separator" },
    {
      label: "Mini Player",
      click: () => sendRendererEvent("contextMenuAction", { action: "miniPlayer" }),
    },
    { type: "separator" },
    {
      label: "Quit",
      accelerator: "CmdOrCtrl+Q",
      click: () => app.quit(),
    }
  );

  return Menu.buildFromTemplate(items);
}

const requestHandlers: RequestHandlerMap = {
  getDefaultMusicPath: () => getDefaultMusicPath(),
  scanFolders: ({ paths }) => ({ files: scanFolders(paths) }),
  getTrackMetadata: async ({ path: filePath }) => {
    const metadata = await getTrackMetadata(filePath);
    if (!metadata) {
      return null;
    }

    return {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      duration: metadata.duration,
      time: formatMetadataTime(metadata),
      genre: metadata.genre,
      picture: metadata.picture,
    };
  },
  getPlaybackUrl: ({ path: filePath }) => {
    const port = getAudioServerPort();
    return `http://127.0.0.1:${port}/play?path=${encodeURIComponent(filePath)}`;
  },
  getWatchFolders: () => loadSettings().watchFolders,
  getSettings: () => buildDesktopSettings(),
  saveSettings: (partial) => {
    const settings = loadSettings();
    saveSettings({
      ...settings,
      ...partial,
    });
    return { success: true };
  },
  getYtMusicCacheStats: () => getYtMusicCacheStats(),
  getFullyCachedTrackIds: () => getFullyCachedTrackIds(),
  clearYtMusicCache: () => clearYtMusicCache(),
  clearYtMusicMetadataCache: () => clearYtMusicMetadataCache(),
  addFolder: ({ path: folderPath }) => {
    const resolved = path.resolve(folderPath.trim());

    if (!fs.existsSync(resolved)) {
      return { success: false, error: "Folder does not exist" };
    }

    if (!fs.statSync(resolved).isDirectory()) {
      return { success: false, error: "Path is not a folder" };
    }

    const settings = loadSettings();
    const normalized = path.normalize(resolved);
    const existsAlready = settings.watchFolders.some((entry) => path.normalize(entry) === normalized);

    if (!existsAlready) {
      settings.watchFolders.push(normalized);
      saveSettings(settings);
      setAllowedPaths(settings.watchFolders);
    }

    return { success: true };
  },
  validateFolder: ({ path: folderPath }) => {
    try {
      const resolved = path.resolve(folderPath.trim());

      if (!fs.existsSync(resolved)) {
        return { valid: false, error: "Path does not exist" };
      }

      if (!fs.statSync(resolved).isDirectory()) {
        return { valid: false, error: "Path is not a folder" };
      }

      return { valid: true, resolvedPath: path.normalize(resolved) };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid path",
      };
    }
  },
  removeFolder: ({ path: folderPath }) => {
    const settings = loadSettings();
    settings.watchFolders = settings.watchFolders.filter((entry) => entry !== folderPath);
    saveSettings(settings);
    setAllowedPaths(settings.watchFolders);
  },
  loadPlaylist: ({ path: filePath }) => {
    const playlist = loadPlaylist(filePath);
    if (!playlist) {
      return null;
    }

    return {
      id: `local-playlist:${playlist.path}`,
      provider: "local",
      providerId: playlist.path,
      name: playlist.name,
      path: playlist.path,
      editable: true,
      entries: playlist.entries.map((entry) => ({
        id: `local:${entry.path}`,
        provider: "local" as const,
        providerId: entry.path,
        path: entry.path,
        title: entry.title,
      })),
    };
  },
  savePlaylist: ({ path: targetPath, name, entries }) => {
    savePlaylist(targetPath, name, entries);
  },
  listPlaylists: () =>
    listPlaylists().map((playlist) => ({
      id: `local-playlist:${playlist.path}`,
      provider: "local",
      providerId: playlist.path,
      name: playlist.name,
      path: playlist.path,
      editable: true,
      entries: playlist.entries.map((entry) => ({
        id: `local:${entry.path}`,
        provider: "local" as const,
        providerId: entry.path,
        path: entry.path,
        title: entry.title,
      })),
    })),
  getPlaylistsDir: () => PLAYLISTS_DIR,
  renamePlaylist: ({ oldPath, newName }) => {
    const playlist = loadPlaylist(oldPath);
    if (!playlist) {
      return;
    }

    const directory = path.dirname(oldPath);
    const cleanName = newName.replace(/\.m3u8?$/i, "");
    savePlaylist(directory, cleanName, playlist.entries.map((entry) => entry.path));
    fs.unlinkSync(oldPath);
  },
  deletePlaylist: ({ path: filePath }) => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  },
  importPlaylist: ({ path: filePath }) => {
    const playlist = loadPlaylist(filePath);
    if (!playlist) {
      return false;
    }

    savePlaylist(PLAYLISTS_DIR, playlist.name, playlist.entries.map((entry) => entry.path));
    return true;
  },
  exportPlaylist: ({ name, entries }) => {
    savePlaylist(PLAYLISTS_DIR, name, entries);
    return path.join(PLAYLISTS_DIR, `${name}.m3u8`);
  },
  getPlatform: () => process.platform,
  authGetStatus: () => getYtMusicAuthStatus(),
  authLogin: () => loginToYtMusic(),
  authCompleteLogin: () => completeYtMusicLogin(),
  authCancelLogin: () => cancelYtMusicLogin(),
  authImportSession: ({ cookie, cookieNames, sourceUrl }) => importYtMusicSession(cookie, { cookieNames, sourceUrl }),
  authLogout: () => logoutFromYtMusic(),
  openExternalUrl: async ({ url }) => {
    await shell.openExternal(url);
    return { success: true };
  },
  prepareBrowserBridge: () => prepareBrowserBridgeBundle(),
  installBrowserBridgeHost: () => installBrowserBridgeHost(),
  openPath: async ({ path: targetPath }) => {
    await shell.openPath(targetPath);
    return { success: true };
  },
  ytmusicSyncLibrary: () => syncYtMusicLibrary(),
  ytmusicLoadCachedLibrary: () => {
    if (loadSettings().ytmusicUseLibraryDiskCache === false) {
      return null;
    }
    const cached = getCachedYtMusicLibrary();
    return {
      tracks: cached.tracks,
      playlists: cached.playlists,
      lastSyncedAt: cached.lastSyncedAt ?? 0,
    };
  },
  ytmusicSearch: async ({ query }) => {
    const s = loadSettings();
    const cacheOn = s.ytmusicSearchCacheEnabled !== false;
    const ttlMs = (s.ytmusicSearchCacheTtlMinutes ?? 30) * 60_000;
    const maxEntries = s.ytmusicSearchCacheMaxEntries ?? 100;
    if (cacheOn) {
      const hit = getCachedYtMusicSearch(query, ttlMs);
      if (hit) {
        return hit;
      }
    }
    const results = await searchYtMusic(query);
    if (cacheOn) {
      setCachedYtMusicSearch(query, results, maxEntries);
    }
    return results;
  },
  ytmusicGetPlaylist: ({ playlistId }) => getYtMusicPlaylist(playlistId),
  ytmusicGetPlayback: ({ trackId, providerId }) => getYtMusicPlayback(trackId, providerId),
  ytmusicLike: ({ videoId }) => likeYtMusicTrack(videoId),
  ytmusicUnlike: ({ videoId }) => unlikeYtMusicTrack(videoId),
  ytmusicCreatePlaylist: ({ name, trackProviderIds }) => createYtMusicPlaylist(name, trackProviderIds),
  ytmusicRenamePlaylist: ({ playlistId, name }) => renameYtMusicPlaylist(playlistId, name),
  ytmusicDeletePlaylist: ({ playlistId }) => deleteYtMusicPlaylist(playlistId),
  ytmusicAddTrackToPlaylist: ({ playlistId, videoId }) => addTrackToYtMusicPlaylist(playlistId, videoId),
  ytmusicRemoveTrackFromPlaylist: ({ playlistId, videoId }) => removeTrackFromYtMusicPlaylist(playlistId, videoId),
  getAppVersion: () => app.getVersion(),
  checkForUpdates: () => {
    autoUpdater.checkForUpdates().catch(handleUpdateCheckError);
  },
  installUpdate: () => {
    autoUpdater.quitAndInstall(false, true);
  },
};

const messageHandlers: MessageHandlerMap = {
  resizeWindow: ({ width, height }) => {
    if (!mainWindow) {
      return;
    }

    mainWindow.setSize(Math.max(width, currentMinWidth), Math.max(height, currentMinHeight));
  },
  setMinSize: ({ width, height }) => {
    currentMinWidth = width;
    currentMinHeight = height;
    mainWindow?.setMinimumSize(width, height);
  },
  closeWindow: () => {
    mainWindow?.close();
  },
  minimizeWindow: () => {
    mainWindow?.minimize();
  },
  maximizeWindow: () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  },
  showContextMenu: () => {
    if (!mainWindow) {
      return;
    }

    buildContextMenu().popup({ window: mainWindow });
  },
  updateNowPlaying: ({ title, artist, isPlaying: nextIsPlaying }) => {
    currentTrackTitle = title;
    currentTrackArtist = artist;
    isPlaying = nextIsPlaying;
    updateWindowTitle();
    updateTrayMenu();
  },
  clearNowPlaying: () => {
    currentTrackTitle = "";
    currentTrackArtist = "";
    isPlaying = false;
    updateWindowTitle();
    updateTrayMenu();
  },
};

function registerIpc() {
  (Object.entries(requestHandlers) as [keyof RequestHandlerMap, RequestHandlerMap[keyof RequestHandlerMap]][]).forEach(
    ([channel, handler]) => {
      ipcMain.handle(`desktop:request:${String(channel)}`, (_event, params) => handler(params as never));
    }
  );

  (Object.entries(messageHandlers) as [keyof MessageHandlerMap, MessageHandlerMap[keyof MessageHandlerMap]][]).forEach(
    ([channel, handler]) => {
      ipcMain.on(`desktop:message:${String(channel)}`, (_event, payload) => {
        (handler as (arg?: unknown) => void)(payload);
      });
    }
  );
}

async function createMainWindow() {
  await startAudioServer();

  const settings = loadSettings();
  if (settings.watchFolders.length > 0) {
    setAllowedPaths(settings.watchFolders);
  }

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: currentMinWidth,
    minHeight: currentMinHeight,
    frame: false,
    backgroundColor: "#0a0a0a",
    show: false,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    setYtMusicCacheStatsListener(null);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer failed to load:", { errorCode, errorDescription, validatedURL });
  });

  const rendererEntry = getRendererEntry();
  if (rendererEntry) {
    await mainWindow.loadURL(rendererEntry);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  setupTray();
  createApplicationMenu();
  updateWindowTitle();

  setYtMusicCacheStatsListener(() => {
    sendRendererEvent("ytmusicCacheStatsUpdated", getYtMusicCacheStats());
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }

  registerIpc();
  await createMainWindow();

  // ── Auto-updater (production only) ──
  if (!process.env["VITE_DEV_SERVER_URL"]) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      sendRendererEvent("autoUpdateStatus", { status: "checking" });
    });
    autoUpdater.on("update-available", (info) => {
      sendRendererEvent("autoUpdateStatus", { status: "available", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      sendRendererEvent("autoUpdateStatus", { status: "not-available" });
    });
    autoUpdater.on("download-progress", (progress) => {
      sendRendererEvent("autoUpdateStatus", { status: "downloading", percent: Math.round(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      sendRendererEvent("autoUpdateStatus", { status: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (err) => {
      handleUpdateCheckError(err);
    });

    autoUpdater.checkForUpdatesAndNotify().catch(handleUpdateCheckError);
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
}
