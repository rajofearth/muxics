# Muxics Integration Notes

## Current YT Music Status
- Browser-extension session import works through the localhost bridge.
- YT Music library sync is authenticated and currently returns songs and playlists.
- The `Songs` library filter now resolves correctly after unwrapping nested chip commands.
- Playback still needs hardening because some YT Music stream formats fail deciphering.

## Problems We Hit
- Google blocked embedded sign-in inside Electron.
- `youtubei.js` device auth signed in, but private YT Music library requests still failed or behaved as signed out.
- Broad cookie capture from the browser produced invalid session headers.
- YT Music requests were sent to `www.youtube.com` instead of `music.youtube.com`.
- The `Songs` chip endpoint was nested inside command wrappers, so sync kept reading the landing page instead of the songs shelf.
- `youtubei.js` parser paths for library data were brittle, so raw response extraction was needed.
- Playback failed because `getStreamingData()` could choose a bad format and abort even when other valid audio formats existed.

## Fixes That Worked
- Replaced embedded login with browser-session import from an unpacked extension.
- Switched the bridge from native messaging to a localhost handoff.
- Scoped cookie capture to real browser-sendable YouTube Music cookies.
- Rewrote YT Music API requests to use `https://music.youtube.com` with music origin headers and `SAPISIDHASH`.
- Added raw JSON dumps for library responses under the app-data debug folder.
- Extracted library tracks and playlists from raw browse responses instead of relying fully on `youtubei.js` library wrappers.
- Unwrapped nested chip commands so the `Songs` filter resolves to the real songs browse target.
- Changed playback resolution to inspect multiple streaming formats instead of trusting a single `getStreamingData()` result.

## Important Files
- `src/electron/backend/ytmusic.ts`
- `src/electron/backend/ytmusicSession.ts`
- `src/electron/backend/audioServer.ts`
- `assets/browser-extension/manifest.json`
- `assets/browser-extension/popup.js`
- `src/mainview/MainWindow.tsx`

## How To Make The App Fully Functional
1. Finish YT Music playback hardening.
   - Keep using `getBasicInfo().streaming_data`.
   - Prefer direct audio URLs first.
   - Fall back across multiple audio candidates before failing.
   - Log candidate summaries only on failure.
2. Verify all YT Music flows end to end.
   - library sync
   - homepage songs
   - playlist open/play
   - search
   - like/unlike
   - playlist create, rename, delete, add, remove
3. Reduce debug-only logging and keep only actionable auth/playback logs.
4. Polish the YT Music UI so it feels intentional, not temporary.
   - Keep local-library UX separate from YT Music UX.
   - Do not show local empty states while `YT Music` is selected.
5. Package the extension handoff cleanly.
   - keep clear setup steps
   - ensure extension reload after updates
   - validate imported session before claiming success

## Debugging Tips
- Library dumps are written to:
  - `%APPDATA%\\muse.electrobun.dev\\ytmusic\\debug\\library-landing.json`
  - `%APPDATA%\\muse.electrobun.dev\\ytmusic\\debug\\library-songs.json`
  - `%APPDATA%\\muse.electrobun.dev\\ytmusic\\debug\\library-playlists.json`
- If sync says signed out, first verify:
  - request host is `music.youtube.com`
  - `Authorization: SAPISIDHASH ...` is applied
  - imported cookies include a SAPISID-family cookie
- If songs disappear again, inspect the dumped `library-songs.json` before changing extractor logic.
- If playback fails, inspect streaming candidates instead of assuming the first chosen format is valid.
