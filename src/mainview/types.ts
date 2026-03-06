export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  time: string;
  genre: string;
  picture?: string;
}

export interface Mix {
  id: string;
  name: string;
  tracks: string[];
  desc: string;
}

export interface Playlist {
  id: string;
  name: string;
  path: string;
  trackIds: string[];
}

export interface Artist {
  id: string;
  name: string;
  desc: string;
}

export interface Radio {
  id: string;
  name: string;
  desc: string;
}

export type NavView =
  | "home"
  | "library"
  | "artists"
  | "artist_detail"
  | "albums"
  | "album_detail"
  | "playlists"
  | "playlist_detail"
  | "folders"
  | "favorites"
  | "recent"
  | "queue";

export type RepeatMode = "off" | "all" | "one";

export interface RecentPlay {
  path: string;
  playedAt: number;
}

export interface NavState {
  view: NavView;
  id?: string;
}
