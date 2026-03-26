export type MusicProvider = "local" | "ytmusic";
export type LibrarySource = "all" | "local" | "ytmusic";
export type PlaybackMode = "direct" | "hidden" | "unavailable";

export interface ScannedFileResult {
  path: string;
  ext: string;
}

export interface TrackMetadataResult {
  title: string;
  artist: string;
  album: string;
  duration: number;
  time: string;
  genre: string;
  picture?: string;
}

export interface TrackPlaybackResult {
  mode: PlaybackMode;
  targetId?: string;
  url?: string;
  expiresAt?: number;
  loudnessDb?: number;
  error?: string;
}

export interface CacheStatsResult {
  usageBytes: number;
  limitBytes: number;
}

export type AutoUpdateStatus =
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

export interface TrackResult {
  id: string;
  provider: MusicProvider;
  providerId: string;
  path?: string;
  title: string;
  artist: string;
  album: string;
  time: string;
  duration: number;
  genre: string;
  picture?: string;
  sourceLabel?: string;
  playback?: TrackPlaybackResult;
  liked?: boolean;
}

export interface PlaylistEntryResult {
  id: string;
  provider: MusicProvider;
  providerId: string;
  path?: string;
  title?: string;
}

export interface PlaylistResult {
  id: string;
  provider: MusicProvider;
  providerId: string;
  name: string;
  path?: string;
  editable?: boolean;
  entries: PlaylistEntryResult[];
  tracks?: TrackResult[];
  /** From YT Music subtitle (e.g. "48 songs") when full track list is not loaded yet */
  listedItemCount?: number;
  author?: string;
  picture?: string;
  type?: "playlist" | "album";
}

export interface AuthStatusResult {
  loggedIn: boolean;
  provider: "ytmusic";
  profileName?: string;
  avatarUrl?: string;
  lastSyncedAt?: number;
  persistent: boolean;
  error?: string;
}

export interface PendingYtMusicLoginResult {
  kind: "pending_verification";
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}

export interface CompletedYtMusicLoginResult {
  kind: "completed";
  auth: AuthStatusResult;
}

export interface AlreadyLoggedInYtMusicLoginResult {
  kind: "already_logged_in";
  auth: AuthStatusResult;
}

export interface ErrorYtMusicLoginResult {
  kind: "error";
  message: string;
}

export interface ImportYtMusicSessionResult {
  success: boolean;
  auth?: AuthStatusResult;
  error?: string;
}

export interface ImportYtMusicSessionParams {
  cookie: string;
  cookieNames?: string[];
  sourceUrl?: string;
}

export interface BrowserBridgeBundleResult {
  success: boolean;
  extensionId: string;
  folderPath?: string;
  zipPath?: string;
  error?: string;
}

export interface BrowserBridgeHostInstallResult {
  success: boolean;
  extensionId: string;
  hostName: string;
  error?: string;
}

export type AuthLoginStartResult =
  | PendingYtMusicLoginResult
  | CompletedYtMusicLoginResult
  | AlreadyLoggedInYtMusicLoginResult
  | ErrorYtMusicLoginResult;

export type AuthLoginCompleteResult =
  | CompletedYtMusicLoginResult
  | ErrorYtMusicLoginResult;

export interface YTMusicLibrarySyncResult {
  tracks: TrackResult[];
  playlists: PlaylistResult[];
  lastSyncedAt: number;
}

export interface YTMusicHomeResult {
  tracks: TrackResult[];
}

export interface YTMusicHomeSectionResult {
  title: string;
  items: (TrackResult | PlaylistResult)[];
}

export interface YTMusicHomeFeedResult {
  sections: YTMusicHomeSectionResult[];
}

export interface DesktopSettings {
  ytmusicCacheLimitBytes: number;
  ytmusicUseLibraryDiskCache: boolean;
  ytmusicHomeSnapshotEnabled: boolean;
  ytmusicSearchCacheEnabled: boolean;
  ytmusicSearchCacheTtlMinutes: number;
  ytmusicSearchCacheMaxEntries: number;
  /** Verbose YT library sync: on-disk JSON dumps + extraction stats (dev / troubleshooting). */
  ytmusicLibrarySyncDebug: boolean;
}

export interface DesktopRequestMap {
  getDefaultMusicPath: { params: void; response: string };
  scanFolders: { params: { paths: string[] }; response: { files: ScannedFileResult[] } };
  getTrackMetadata: { params: { path: string }; response: TrackMetadataResult | null };
  getPlaybackUrl: { params: { path: string }; response: string };
  getWatchFolders: { params: void; response: string[] };
  getSettings: { params: void; response: DesktopSettings };
  saveSettings: {
    params: Partial<DesktopSettings>;
    response: { success: boolean };
  };
  getYtMusicCacheStats: { params: void; response: CacheStatsResult };
  getFullyCachedTrackIds: { params: void; response: string[] };
  clearYtMusicCache: { params: void; response: { success: boolean } };
  clearYtMusicMetadataCache: { params: void; response: { success: boolean } };
  addFolder: { params: { path: string }; response: { success: boolean; error?: string } };
  validateFolder: {
    params: { path: string };
    response: { valid: boolean; resolvedPath?: string; error?: string };
  };
  removeFolder: { params: { path: string }; response: void };
  loadPlaylist: { params: { path: string }; response: PlaylistResult | null };
  savePlaylist: {
    params: { path: string; name: string; entries: string[] };
    response: void;
  };
  listPlaylists: { params: void; response: PlaylistResult[] };
  getPlaylistsDir: { params: void; response: string };
  renamePlaylist: { params: { oldPath: string; newName: string }; response: void };
  deletePlaylist: { params: { path: string }; response: void };
  importPlaylist: { params: { path: string }; response: boolean };
  exportPlaylist: { params: { name: string; entries: string[] }; response: string };
  getPlatform: { params: void; response: string };
  authGetStatus: { params: void; response: AuthStatusResult };
  authLogin: { params: void; response: AuthLoginStartResult };
  authCompleteLogin: { params: void; response: AuthLoginCompleteResult };
  authCancelLogin: { params: void; response: { success: boolean } };
  authImportSession: { params: ImportYtMusicSessionParams; response: ImportYtMusicSessionResult };
  authLogout: { params: void; response: AuthStatusResult };
  openExternalUrl: { params: { url: string }; response: { success: boolean } };
  prepareBrowserBridge: { params: void; response: BrowserBridgeBundleResult };
  installBrowserBridgeHost: { params: void; response: BrowserBridgeHostInstallResult };
  openPath: { params: { path: string }; response: { success: boolean } };
  ytmusicSyncLibrary: { params: void; response: YTMusicLibrarySyncResult };
  ytmusicLoadCachedLibrary: { params: void; response: YTMusicLibrarySyncResult | null };
  ytmusicSearch: { params: { query: string }; response: TrackResult[] };
  ytmusicGetHomeFeed: { params: void; response: YTMusicHomeFeedResult };
  ytmusicGetPlaylist: { params: { playlistId: string }; response: PlaylistResult | null };
  ytmusicGetPlayback: { params: { trackId: string; providerId: string }; response: TrackPlaybackResult };
  ytmusicLike: { params: { videoId: string }; response: { success: boolean } };
  ytmusicUnlike: { params: { videoId: string }; response: { success: boolean } };
  ytmusicCreatePlaylist: {
    params: { name: string; trackProviderIds?: string[] };
    response: { success: boolean; playlistId?: string };
  };
  ytmusicRenamePlaylist: {
    params: { playlistId: string; name: string };
    response: { success: boolean };
  };
  ytmusicDeletePlaylist: {
    params: { playlistId: string };
    response: { success: boolean };
  };
  ytmusicAddTrackToPlaylist: {
    params: { playlistId: string; videoId: string };
    response: { success: boolean };
  };
  ytmusicRemoveTrackFromPlaylist: {
    params: { playlistId: string; videoId: string };
    response: { success: boolean };
  };
  getAppVersion: { params: void; response: string };
  checkForUpdates: { params: void; response: void };
  installUpdate: { params: void; response: void };
}

export interface DesktopMessageMap {
  resizeWindow: { width: number; height: number };
  setMinSize: { width: number; height: number };
  closeWindow: void;
  minimizeWindow: void;
  maximizeWindow: void;
  showContextMenu: void;
  updateNowPlaying: { title: string; artist: string; isPlaying: boolean };
  clearNowPlaying: void;
}

export interface DesktopEventMap {
  contextMenuAction: { action: string };
  menuAction: { action: string };
  ytmusicCacheStatsUpdated: CacheStatsResult;
  autoUpdateStatus: AutoUpdateStatus;
}

type RequestMethods = {
  [K in keyof DesktopRequestMap]: DesktopRequestMap[K]["params"] extends void
    ? () => Promise<DesktopRequestMap[K]["response"]>
    : (params: DesktopRequestMap[K]["params"]) => Promise<DesktopRequestMap[K]["response"]>;
};

type MessageMethods = {
  [K in keyof DesktopMessageMap]: DesktopMessageMap[K] extends void
    ? () => void
    : (payload: DesktopMessageMap[K]) => void;
};

export interface DesktopBridge {
  request: RequestMethods;
  send: MessageMethods;
}
