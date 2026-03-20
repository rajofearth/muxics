# Muxics YT Music Notes

## What We Learned
- Electron embedded sign-in was unreliable, so YT Music auth moved to browser-session import through the localhost bridge.
- Private YT Music requests only work when they are sent to `music.youtube.com` with the right origin headers and SAPISID-style auth.
- `youtubei.js` (authenticated InnerTube against `music.youtube.com`) drives library sync, playlist hydration, and playback URL resolution.
- YT playback must use a single clean handoff path; stale async loads and direct renderer URL handling caused most of the playback bugs.

## Problems And Fixes
- Sign-in failed inside Electron.
  - Fixed by importing the browser session from an unpacked extension via the localhost bridge.
- Library sync returned empty or wrong data.
  - Fixed by using `music.youtube.com`, unwrapping nested chip commands, and extracting from raw browse data when needed.
- Playback failed on some YT tracks.
  - Fixed by resolving streams via InnerTube (`getStreamingData` / format deciphering), preferring audio, and routing through the local audio server/cache.
- YT playlists opened without tracks.
  - Fixed by hydrating playlists on first open and persisting the hydrated track list in cache.
- Track switching could keep the old song playing too long.
  - Fixed by canceling stale loads and stopping/resetting the current audio element immediately on switch.

## Current State
- Browser-session import works.
- YT Music auth is active and library sync returns songs and playlists.
- YT playlists hydrate their tracks on open.
- YT playback uses cached/localized media URLs through the audio server.
- YT artwork and audio are cached on disk under app data.

## How To Keep It Fully Functional
1. Keep YT auth aligned with the browser bridge.
   - Verify cookies are imported from a logged-in `music.youtube.com` session.
   - Keep requests on `music.youtube.com` with `SAPISIDHASH` headers.
2. Keep playlist hydration and playback URL resolution on the same `youtubei.js` backend path (`ytmusic.ts`).
   - Prefer audio-only streams when choosing formats.
3. Keep playback routed through the local audio server and cache.
   - Use localhost URLs for YT audio/artwork.
   - Cache recent audio, artwork, and hydrated playlist data in app data.
4. Keep the main library UI consistent across sources.
   - YT Music uses the same “All Songs” / grid views as local files; only sign-in and sync states differ.
5. Validate the full YT flow after any change.
   - Auth import
   - Library sync
   - Library “All Songs” (synced tracks)
   - Playlist open/play
   - Search
   - Like/unlike
   - Playlist create/rename/delete/add/remove
   - Track switching

## Useful Files
- `src/electron/backend/ytmusic.ts`
- `src/electron/backend/ytmusicHomeSnapshot.ts`
- `src/electron/backend/ytMusicCache.ts`
- `src/electron/backend/audioServer.ts`
- `src/mainview/MainWindow.tsx`
- `src/mainview/components/MainWindowContent.tsx`
- `src/electron/backend/ytmusicStrings.ts`
- `src/mainview/hooks/useAudioEngine.ts`
