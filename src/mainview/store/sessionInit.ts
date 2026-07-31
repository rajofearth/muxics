import type { DesktopBridge } from "../../shared/desktop-contract";
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

  setInitStatus("Checking authentication...");
  try {
    await loadAuthStatus();
  } catch (err) {
    console.error("initSession: loadAuthStatus failed", err);
  }
  const loggedIn = useAuthStore.getState().auth.loggedIn;

  setInitStatus("Scanning local library...");
  const libraryPromise = loadLibrary();

  setInitStatus("Loading playlists...");
  const playlistsPromise = loadPlaylists();

  let cachePromise = Promise.resolve();
  if (loggedIn) {
    setInitStatus("Loading YouTube Music...");
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
      setInitStatus("Syncing YouTube Music...");
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

  setInitStatus("Almost ready...");
  // Small tick so the final status renders before transitioning
  await new Promise((r) => setTimeout(r, 200));

  setInitReady();
}
