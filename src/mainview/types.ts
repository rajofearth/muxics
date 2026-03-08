export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  time: string;
  duration: number;
  genre: string;
  picture?: string;
}

export interface Playlist {
  id: string;
  name: string;
  path: string;
  trackIds: string[];
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
