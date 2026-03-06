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

export interface PlaylistEntryResult {
  path: string;
  title?: string;
}

export interface PlaylistResult {
  name: string;
  path: string;
  entries: PlaylistEntryResult[];
}

export interface LibraryTrackResult {
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  time: string;
  genre: string;
  picture?: string;
}

export type WinampRPCSchema = {
  bun: {
    requests: {
      getDefaultMusicPath: { params: void; response: string };
      scanLibrary: { params: { paths: string[] }; response: { tracks: LibraryTrackResult[] } };
      scanFolders: { params: { paths: string[] }; response: { files: ScannedFileResult[] } };
      getTrackMetadata: { params: { path: string }; response: TrackMetadataResult | null };
      getPlaybackUrl: { params: { path: string }; response: string };
      getWatchFolders: { params: void; response: string[] };
      addFolder: { params: { path: string }; response: { success: boolean; error?: string } };
      validateFolder: { params: { path: string }; response: { valid: boolean; resolvedPath?: string; error?: string } };
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
    };
    messages: {
      resizeWindow: { width: number; height: number };
      setMinSize: { width: number; height: number };
      closeWindow: void;
      minimizeWindow: void;
      maximizeWindow: void;
      showContextMenu: void;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      contextMenuAction: { action: string };
    };
  };
};
