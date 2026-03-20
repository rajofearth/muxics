---
name: yt-performance-optimizations
overview: Reduce renderer churn, virtualize large YouTube Music collections, and batch backend cache/sync work so large YT libraries stop causing frame drops and memory spikes.
todos:
  - id: audit-render-subscriptions
    content: Audit and narrow store subscriptions so playback timer updates do not rerender the whole renderer tree.
    status: completed
  - id: virtualize-large-lists
    content: Virtualize `TrackTable` and any other long YT list/grid views, then stabilize row props and callbacks.
    status: completed
  - id: optimize-search-path
    content: Debounce YT search, add request de-duplication/cancellation, and precompute artist/album suggestion indexes.
    status: completed
  - id: batch-backend-io
    content: Reduce synchronous YT cache/index rewrites and gate expensive debug dumps/logging in the Electron main process.
    status: completed
  - id: validate-large-library
    content: Measure the app with a large YT library and verify memory, frame pacing, and search/playback responsiveness improvements.
    status: completed
isProject: false
---

# YT Performance Optimizations

I traced the likely hotspots to the renderer subscription pattern, unvirtualized list views, and synchronous YT cache/sync work in the Electron main process. The plan is to fix the biggest structural costs first, then validate the impact on a 300-1000 track YT library.

## What to change

- Tighten top-level store subscriptions in [src/mainview/App.tsx](src/mainview/App.tsx) and [src/mainview/MainWindow.tsx](src/mainview/MainWindow.tsx).
  - `App` currently pulls the whole store object, so frequent `currentTime` updates from [src/mainview/hooks/useAudioEngine.ts](src/mainview/hooks/useAudioEngine.ts) can fan out through the whole tree.
  - `MainWindow` also subscribes broadly and recomputes derived data from `library.tracks` on render.
- Reduce repeated derivation work in [src/mainview/MainWindow.tsx](src/mainview/MainWindow.tsx) and [src/mainview/components/SearchView.tsx](src/mainview/components/SearchView.tsx).
  - Replace repeated `Set + filter` scans with single-pass `Map` indexes for artists/albums.
  - Move search suggestions onto precomputed indexes instead of rescanning the full track list on every query change.
- Virtualize the large collections rendered by [src/mainview/components/TrackTable.tsx](src/mainview/components/TrackTable.tsx) and any similar long lists/grids.
  - `TrackTable` currently renders every row and sorts the full array in memory.
  - Apply the same treatment to any queue/grid views that can grow large.
- Debounce and de-race YT search in [src/mainview/store/playerStore.ts](src/mainview/store/playerStore.ts).
  - `setSearchQuery()` does local scans immediately and can launch overlapping remote searches.
  - Add a debounce/token so stale responses cannot overwrite newer input.
- Cut synchronous cache churn and debug I/O in [src/electron/backend/ytmusic.ts](src/electron/backend/ytmusic.ts) and [src/electron/backend/ytMusicCache.ts](src/electron/backend/ytMusicCache.ts).
  - Gate the large `writeDebugJson()`/"Library extraction stats" path behind an explicit debug flag.
  - Stop rewriting the media index on every cache hit/touch; batch updates or keep an in-memory dirty index with periodic flushes.
  - Avoid recomputing cache stats by scanning the full index on every poll.
- Revisit playlist hydration and cache update granularity.
  - [src/mainview/MainWindow.tsx](src/mainview/MainWindow.tsx) triggers hydration when playlist state changes.
  - [src/electron/backend/ytmusic.ts](src/electron/backend/ytmusic.ts) and [src/mainview/store/playerStore.ts](src/mainview/store/playerStore.ts) currently rewrite broad YT cache/library blobs; incremental updates would scale better.

## Validation

- Test with a large YT account/library and compare: startup time, frame drops while playback is active, memory usage, and search latency.
- Confirm the renderer no longer rerenders the whole shell on each `currentTime` tick.
- Confirm large track lists stay responsive after virtualization and search debouncing.
- Confirm backend cache writes drop sharply during normal playback and browsing.

## Files to inspect first

- [src/mainview/hooks/useAudioEngine.ts](src/mainview/hooks/useAudioEngine.ts)
- [src/mainview/App.tsx](src/mainview/App.tsx)
- [src/mainview/MainWindow.tsx](src/mainview/MainWindow.tsx)
- [src/mainview/components/TrackTable.tsx](src/mainview/components/TrackTable.tsx)
- [src/mainview/components/SearchView.tsx](src/mainview/components/SearchView.tsx)
- [src/mainview/store/playerStore.ts](src/mainview/store/playerStore.ts)
- [src/electron/backend/ytmusic.ts](src/electron/backend/ytmusic.ts)
- [src/electron/backend/ytMusicCache.ts](src/electron/backend/ytMusicCache.ts)

