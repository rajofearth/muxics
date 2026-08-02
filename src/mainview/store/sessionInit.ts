import type { DesktopBridge } from "../../shared/desktop-contract";
import { bench } from "../bench";
import {
  useAuthStore,
  INIT_STATUS_SESSION_REJECTED,
  INIT_STATUS_RECOVERING,
} from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { usePlaylistStore } from "./playlistStore";
import { usePlayerStore } from "./playerStore";
import { showToast } from "../components/Toast";

export async function initSession(desktop: DesktopBridge): Promise<void> {
  const { setRpc, loadAuthStatus } = useAuthStore.getState();
  const { loadLibrary, hydrateYtMusicFromCache, syncYtMusicLibrary } =
    useLibraryStore.getState();
  const { loadPlaylists } = usePlaylistStore.getState();
  const { setInitReady, setInitStatus } = usePlayerStore.getState();

  // Set RPC
  setRpc(desktop);

  // Bench: splash stages — mark each initSession stage and measure
  // stage→stage plus first stage → ready.
  let firstStageMark: string | null = null;
  let prevStageMark: string | null = null;
  const stage = (label: string) => {
    setInitStatus(label);
    const markName = `initSession:${label}`;
    bench.mark(markName);
    if (prevStageMark) {
      bench.measure(`${prevStageMark} → ${markName}`, prevStageMark, markName);
    } else {
      firstStageMark = markName;
    }
    prevStageMark = markName;
  };

  stage("Checking authentication...");
  try {
    await loadAuthStatus();
  } catch (err) {
    console.error("initSession: loadAuthStatus failed", err);
  }
  const loggedIn = useAuthStore.getState().auth.loggedIn;

  stage("Scanning local library...");
  const libraryPromise = loadLibrary();

  stage("Loading playlists...");
  const playlistsPromise = loadPlaylists();

  let cachePromise = Promise.resolve();
  if (loggedIn) {
    stage("Loading YouTube Music...");
    cachePromise = hydrateYtMusicFromCache();
  }

  const settled = await Promise.allSettled([
    libraryPromise,
    playlistsPromise,
    cachePromise,
  ]);
  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("initSession: startup step failed", result.reason);
    }
  }

  const source = useLibraryStore.getState().library.source;
  const isLocalMode = source === "local";

  if (loggedIn) {
    if (isLocalMode) {
      // In local mode, fire remote library sync in the background so boot is instant.
      // The action swallows its own failures into library.error, so once the sync
      // settles, surface a freshly-set error with a toast. Syncs rejected by the
      // browser session skip error state and auto-recover — no toast there.
      const errorBeforeSync = useLibraryStore.getState().library.error;
      void syncYtMusicLibrary().then(() => {
        const error = useLibraryStore.getState().library.error;
        if (
          error &&
          error !== errorBeforeSync &&
          !error.includes("Imported browser session")
        ) {
          showToast(error, "error");
        }
      });
    } else {
      stage("Syncing YouTube Music...");
      try {
        await syncYtMusicLibrary();
      } catch (err) {
        console.error("initSession: syncYtMusicLibrary failed", err);
      }

      const authState = useAuthStore.getState().auth;
      if (authState.sessionExpired) {
        setInitStatus(INIT_STATUS_SESSION_REJECTED);
        return;
      }
      if (authState.recovering) {
        setInitStatus(INIT_STATUS_RECOVERING);
        return;
      }
    }
  }

  stage("Almost ready...");
  // Small tick so the final status renders before transitioning
  await new Promise((r) => setTimeout(r, 200));

  setInitReady();
  // Bench: initSession done — the splash → ready transition.
  bench.mark("initSession:done");
  if (firstStageMark) {
    bench.measure(
      "initSession:first stage → ready",
      firstStageMark,
      "initSession:done",
    );
  }
}
