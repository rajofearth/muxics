import path from "path";
import fs from "fs";
import Electrobun, { BrowserWindow, BrowserView, ContextMenu, Tray, ApplicationMenu } from "electrobun/bun";
import type { WinampRPCSchema } from "../shared/rpc-types";
import { getDefaultMusicPath } from "./paths";
import { scanFolders } from "./scanner";
import { getTrackMetadata, formatMetadataTime } from "./metadata";
import { startAudioServer, setAllowedPaths, getAudioServerPort } from "./audioServer";
import { loadPlaylist, savePlaylist, listPlaylists } from "./playlists";
import { loadSettings, saveSettings } from "./settings";
import { PLAYLISTS_DIR } from "./paths";

let mainWindow: InstanceType<typeof BrowserWindow>;
let winampRpc: ReturnType<typeof BrowserView.defineRPC<WinampRPCSchema>>;
let tray: InstanceType<typeof Tray> | null = null;

const APP_NAME = "Muse";
const MAIN_MIN_WIDTH = 800;
const MAIN_MIN_HEIGHT = 600;

let currentMinWidth = MAIN_MIN_WIDTH;
let currentMinHeight = MAIN_MIN_HEIGHT;
let currentTrackTitle = "";
let currentTrackArtist = "";
let isPlaying = false;

async function init(): Promise<void> {
  await startAudioServer();
  const settings = loadSettings();
  if (settings.watchFolders.length > 0) {
    setAllowedPaths(settings.watchFolders);
  }
}

function updateWindowTitle() {
  if (!mainWindow) return;
  if (currentTrackTitle) {
    mainWindow.setTitle(`${currentTrackTitle} — ${currentTrackArtist}`);
  } else {
    mainWindow.setTitle(APP_NAME);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];

  if (currentTrackTitle) {
    items.push(
      { label: currentTrackTitle, enabled: false, action: "noop" },
      { label: currentTrackArtist, enabled: false, action: "noop" },
      { type: "separator" },
    );
  }

  items.push(
    { label: isPlaying ? "Pause" : "Play", action: "playPause" },
    { label: "Next Track", action: "next" },
    { label: "Previous Track", action: "prev" },
    { type: "separator" },
    { label: "Show Window", action: "showWindow" },
    { type: "separator" },
    { label: "Quit", action: "quit" },
  );

  tray.setMenu(items);
}

function setupTray() {
  try {
    tray = new Tray({
      title: APP_NAME,
      template: true,
      width: 18,
      height: 18,
    });

    tray.on("tray-clicked", () => {
      mainWindow?.focus();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tray as any).on("tray-item-clicked", (e: { data?: { action?: string } }) => {
      const action = e?.data?.action;
      if (!action) return;

      switch (action) {
        case "playPause":
        case "next":
        case "prev":
          winampRpc?.send?.contextMenuAction({ action });
          break;
        case "showWindow":
          mainWindow?.focus();
          break;
        case "quit":
          mainWindow?.close();
          break;
      }
    });

    updateTrayMenu();
  } catch (err) {
    console.warn("Tray not available on this platform:", err);
  }
}

function setupApplicationMenu() {
  try {
    ApplicationMenu.setApplicationMenu([
      {
        label: APP_NAME,
        submenu: [
          { label: `About ${APP_NAME}`, role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: `Quit ${APP_NAME}`, role: "quit", accelerator: "CmdOrCtrl+Q" },
        ],
      },
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
          { label: "Play / Pause", action: "playPause", accelerator: "Space" },
          { label: "Next Track", action: "next", accelerator: "CmdOrCtrl+Right" },
          { label: "Previous Track", action: "prev", accelerator: "CmdOrCtrl+Left" },
          { type: "separator" },
          { label: "Volume Up", action: "volumeUp", accelerator: "CmdOrCtrl+Up" },
          { label: "Volume Down", action: "volumeDown", accelerator: "CmdOrCtrl+Down" },
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Library", action: "viewLibrary", accelerator: "CmdOrCtrl+L" },
          { label: "Now Playing", action: "viewNowPlaying", accelerator: "CmdOrCtrl+N" },
          { label: "Search", action: "viewSearch", accelerator: "CmdOrCtrl+F" },
          { type: "separator" },
          { label: "Mini Player", action: "viewMini" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ],
      },
    ]);
  } catch (err) {
    console.warn("ApplicationMenu not available:", err);
  }
}

const rpc = BrowserView.defineRPC<WinampRPCSchema>({
  handlers: {
    requests: {
      getDefaultMusicPath: () => getDefaultMusicPath(),

      scanFolders: ({ paths }) => {
        const files = scanFolders(paths);
        return { files };
      },

      getTrackMetadata: async ({ path: filePath }) => {
        const meta = await getTrackMetadata(filePath);
        if (!meta) return null;
        return {
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          duration: meta.duration,
          time: formatMetadataTime(meta),
          genre: meta.genre,
          picture: meta.picture,
        };
      },

      getPlaybackUrl: ({ path: filePath }) => {
        const port = getAudioServerPort();
        const encoded = encodeURIComponent(filePath);
        return `http://127.0.0.1:${port}/play?path=${encoded}`;
      },

      getWatchFolders: () => loadSettings().watchFolders,

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
        const alreadyExists = settings.watchFolders.some(
          (p) => path.normalize(p) === normalized
        );
        if (!alreadyExists) {
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
        } catch (err) {
          return {
            valid: false,
            error: err instanceof Error ? err.message : "Invalid path",
          };
        }
      },

      removeFolder: ({ path: folderPath }) => {
        const settings = loadSettings();
        settings.watchFolders = settings.watchFolders.filter((p) => p !== folderPath);
        saveSettings(settings);
        setAllowedPaths(settings.watchFolders);
      },

      loadPlaylist: ({ path: filePath }) => {
        const pl = loadPlaylist(filePath);
        if (!pl) return null;
        return { name: pl.name, path: pl.path, entries: pl.entries };
      },

      savePlaylist: ({ path: targetPath, name, entries }) => {
        savePlaylist(targetPath, name, entries);
      },

      listPlaylists: () => {
        return listPlaylists().map((pl) => ({
          name: pl.name,
          path: pl.path,
          entries: pl.entries,
        }));
      },

      getPlaylistsDir: () => PLAYLISTS_DIR,

      renamePlaylist: ({ oldPath, newName }) => {
        const pl = loadPlaylist(oldPath);
        if (!pl) return;
        const dir = path.dirname(oldPath);
        const cleanName = newName.replace(/\.m3u8?$/i, "");
        savePlaylist(dir, cleanName, pl.entries.map((e) => e.path));
        fs.unlinkSync(oldPath);
      },

      deletePlaylist: ({ path: filePath }) => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      },

      importPlaylist: ({ path: filePath }) => {
        const pl = loadPlaylist(filePath);
        if (!pl) return false;
        savePlaylist(PLAYLISTS_DIR, pl.name, pl.entries.map((e) => e.path));
        return true;
      },

      exportPlaylist: ({ name, entries }) => {
        savePlaylist(PLAYLISTS_DIR, name, entries);
        return path.join(PLAYLISTS_DIR, `${name}.m3u8`);
      },

      getPlatform: () => process.platform,
    },
    messages: {
      resizeWindow: ({ width, height }) => {
        const w = Math.max(width, currentMinWidth);
        const h = Math.max(height, currentMinHeight);
        mainWindow.setSize(w, h);
      },
      setMinSize: ({ width, height }) => {
        currentMinWidth = width;
        currentMinHeight = height;
      },
      closeWindow: () => mainWindow.close(),
      minimizeWindow: () => mainWindow.minimize(),
      maximizeWindow: () => {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      },
      showContextMenu: () => {
        const items: Parameters<typeof ContextMenu.showContextMenu>[0] = [];

        if (currentTrackTitle) {
          items.push(
            { label: `♪ ${currentTrackTitle}`, enabled: false, action: "noop" },
            { label: `  ${currentTrackArtist}`, enabled: false, action: "noop" },
            { type: "separator" },
          );
        }

        items.push(
          { label: isPlaying ? "Pause" : "Play", action: "playPause", accelerator: " " },
          { label: "Previous Track", action: "prev", accelerator: "Left" },
          { label: "Next Track", action: "next", accelerator: "Right" },
          { type: "separator" },
          { label: "Mini Player", action: "miniPlayer" },
          { type: "separator" },
          { label: "Quit", action: "close", accelerator: "q" },
        );

        ContextMenu.showContextMenu(items);
      },
      updateNowPlaying: ({ title, artist, isPlaying: playing }) => {
        currentTrackTitle = title;
        currentTrackArtist = artist;
        isPlaying = playing;
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
    },
  },
});
winampRpc = rpc;

Electrobun.events.on("context-menu-clicked", (e: { data?: { action?: string } }) => {
  const action = e?.data?.action;
  if (action && action !== "noop") {
    winampRpc.send.menuAction({ action });
  }
});

ApplicationMenu.on("application-menu-clicked", (e: unknown) => {
  const action = (e as { data?: { action?: string } })?.data?.action;
  if (action) {
    winampRpc.send.menuAction({ action });
  }
});

await init();

mainWindow = new BrowserWindow({
  title: APP_NAME,
  url: "views://mainview/index.html",
  frame: {
    width: 1200,
    height: 800,
    x: 100,
    y: 100,
  },
  titleBarStyle: "hidden",
  rpc,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
mainWindow.on("resize", (event: any) => {
  const { width, height } = event.data as { width: number; height: number };
  if (width < currentMinWidth || height < currentMinHeight) {
    mainWindow.setSize(
      Math.max(width, currentMinWidth),
      Math.max(height, currentMinHeight)
    );
  }
});

setupTray();
setupApplicationMenu();

console.log(`${APP_NAME} started!`);
