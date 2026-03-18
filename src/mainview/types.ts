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
}

export interface Playlist {
  id: string;
  provider: MusicProvider;
  providerId: string;
  name: string;
  path?: string;
  trackIds: string[];
  editable?: boolean;
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
  | "now_playing";

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
}

export interface PendingAuthLogin {
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}
