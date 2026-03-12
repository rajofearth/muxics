import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopEventMap } from "../shared/desktop-contract";

type RendererEventPayload = {
  [K in keyof DesktopEventMap]: { channel: K; payload: DesktopEventMap[K] };
}[keyof DesktopEventMap];

const desktopBridge: DesktopBridge = {
  request: {
    getDefaultMusicPath: () => ipcRenderer.invoke("desktop:request:getDefaultMusicPath"),
    scanFolders: (params) => ipcRenderer.invoke("desktop:request:scanFolders", params),
    getTrackMetadata: (params) => ipcRenderer.invoke("desktop:request:getTrackMetadata", params),
    getPlaybackUrl: (params) => ipcRenderer.invoke("desktop:request:getPlaybackUrl", params),
    getWatchFolders: () => ipcRenderer.invoke("desktop:request:getWatchFolders"),
    addFolder: (params) => ipcRenderer.invoke("desktop:request:addFolder", params),
    validateFolder: (params) => ipcRenderer.invoke("desktop:request:validateFolder", params),
    removeFolder: (params) => ipcRenderer.invoke("desktop:request:removeFolder", params),
    loadPlaylist: (params) => ipcRenderer.invoke("desktop:request:loadPlaylist", params),
    savePlaylist: (params) => ipcRenderer.invoke("desktop:request:savePlaylist", params),
    listPlaylists: () => ipcRenderer.invoke("desktop:request:listPlaylists"),
    getPlaylistsDir: () => ipcRenderer.invoke("desktop:request:getPlaylistsDir"),
    renamePlaylist: (params) => ipcRenderer.invoke("desktop:request:renamePlaylist", params),
    deletePlaylist: (params) => ipcRenderer.invoke("desktop:request:deletePlaylist", params),
    importPlaylist: (params) => ipcRenderer.invoke("desktop:request:importPlaylist", params),
    exportPlaylist: (params) => ipcRenderer.invoke("desktop:request:exportPlaylist", params),
    getPlatform: () => ipcRenderer.invoke("desktop:request:getPlatform"),
  },
  send: {
    resizeWindow: (payload) => ipcRenderer.send("desktop:message:resizeWindow", payload),
    setMinSize: (payload) => ipcRenderer.send("desktop:message:setMinSize", payload),
    closeWindow: () => ipcRenderer.send("desktop:message:closeWindow"),
    minimizeWindow: () => ipcRenderer.send("desktop:message:minimizeWindow"),
    maximizeWindow: () => ipcRenderer.send("desktop:message:maximizeWindow"),
    showContextMenu: () => ipcRenderer.send("desktop:message:showContextMenu"),
    updateNowPlaying: (payload) => ipcRenderer.send("desktop:message:updateNowPlaying", payload),
    clearNowPlaying: () => ipcRenderer.send("desktop:message:clearNowPlaying"),
  },
};

function dispatchRendererEvent(channel: keyof DesktopEventMap, payload: DesktopEventMap[keyof DesktopEventMap]) {
  const eventName = channel === "contextMenuAction" ? "winamp-context-action" : "winamp-menu-action";
  document.dispatchEvent(new CustomEvent(eventName, { detail: payload.action }));
}

ipcRenderer.on("desktop:event", (_event, message: RendererEventPayload) => {
  dispatchRendererEvent(message.channel, message.payload);
});

contextBridge.exposeInMainWorld("museDesktop", desktopBridge);
