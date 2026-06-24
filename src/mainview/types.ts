export type MusicProvider = "local" | "ytmusic";

export type LibrarySource = "all" | "local" | "ytmusic";

export type PlaybackMode = "direct" | "hidden" | "unavailable";

export interface TrackPlayback {
  mode: PlaybackMode;
  targetId?: string;
  url?: string;
  expiresAt?: number;
  loudnessDb?: number;
}

export interface Track {
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
  playback?: TrackPlayback;
  liked?: boolean;
}

export interface Playlist {
  id: string;
  provider: MusicProvider;
  providerId: string;
  name: string;
  path?: string;
  trackIds: string[];
  editable?: boolean;
  tracks?: Track[];
  /** Shown in sidebar/lists before hydration completes */
  listedItemCount?: number;
  author?: string;
  picture?: string;
  type?: "playlist" | "album";
}

export type RepeatMode = "off" | "all" | "one";

export type NavView =
  | "library"
  | "artists"
  | "artist_detail"
  | "albums"
  | "album_detail"
  | "playlists"
  | "playlist_detail"
  | "folders"
  | "recent"
  | "queue"
  | "search"
  | "favorites"
  | "now_playing"
  | "settings";

export interface NavState {
  view: NavView;
  id?: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  provider: "ytmusic";
  profileName?: string;
  avatarUrl?: string;
  lastSyncedAt?: number;
  persistent: boolean;
  error?: string;
  /** Set when the stored YT Music session is rejected by the server during sync. */
  sessionExpired?: boolean;
}

export interface PendingAuthLogin {
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}
