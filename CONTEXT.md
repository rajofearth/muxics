# Context: Muxics (Winamp Player)

## Overview

Muxics is a desktop music player that combines local file playback with YouTube Music integration. Built on Electron + Vite + React + Tailwind, packaged with electron-builder.

## Architecture

- `src/electron/` — main process: YT Music backend, audio server, caching, IPC handlers
- `src/mainview/` — renderer process: React UI, components, hooks, state (Zustand)
- `src/shared/` — types and utilities shared across both processes
- Playback routes through a local audio server (`audioServer.ts`) that serves cached/streamed media

## YT Music integration

- Auth uses browser-session import via a localhost bridge (not embedded sign-in — it was unreliable)
- All YT Music API requests go to `music.youtube.com` with `SAPISIDHASH` headers
- `youtubei.js` (authenticated InnerTube) drives library sync, playlist hydration, and stream resolution
- Audio and artwork are cached on disk under app data

### Key invariants

1. Keep YT auth aligned with the browser bridge — cookies from a logged-in `music.youtube.com` session
2. Playlist hydration and playback URL resolution go through the ytmusic modules (`ytmusicData.ts` / `ytmusicPlayback.ts`)
3. Prefer audio-only streams when choosing formats
4. Route playback through the local audio server and cache (`localhost` URLs)
5. After any YT change, validate: auth import → library sync → All Songs → playlist open/play → search → like/unlike → playlist CRUD → track switching

## Key files

- `src/electron/backend/ytmusicAuth.ts` — auth status, session import/validation, library page fetch, logout
- `src/electron/backend/ytmusicClient.ts` — Innertube client creation/caching, cookie helpers (SAPISID hash, auth-cookie checks)
- `src/electron/backend/ytmusicData.ts` — library sync, cache persistence, search, home feed, playlist hydration/CRUD
- `src/electron/backend/ytmusicParsing.ts` — response renderer parsing (`toTrack`/`toPlaylist`), renderer collectors, auth-state classification
- `src/electron/backend/ytmusicPlayback.ts` — playback and stream URL resolution
- `src/electron/backend/ytmusicHomeSnapshot.ts` — home page sections
- `src/electron/backend/ytMusicCache.ts` — audio/artwork/data caching
- `src/electron/backend/audioServer.ts` — local media server
- `src/mainview/MainWindow.tsx` — main renderer entry
- `src/mainview/components/MainWindowContent.tsx` — primary UI layout
- `src/mainview/hooks/useAudioEngine.ts` — playback engine hook
- `src/electron/backend/ytmusicStrings.ts` — YT Music string constants
