import type { DesktopBridge } from "../../shared/desktop-contract";
import {
  useAuthStore,
  INIT_STATUS_SESSION_REJECTED,
  INIT_STATUS_RECOVERING,
} from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { usePlaylistStore } from "./playlistStore";
import { usePlayerStore } from "./playerStore";

export async function initSession(desktop: DesktopBridge): Promise<void> {
  const { setRpc, loadAuthStatus } = useAuthStore.getState();
  const { loadLibrary, hydrateYtMusicFromCache, syncYtMusicLibrary } =
    useLibraryStore.getState();
  const { loadPlaylists } = usePlaylistStore.getState();
  const { setInitReady, setInitStatus } = usePlayerStore.getState();

  // Set RPC
  setRpc(desktop);

  setInitStatus("Checking authentication...");
  await loadAuthStatus();
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

  await Promise.all([libraryPromise, playlistsPromise, cachePromise]);

  const source = useLibraryStore.getState().library.source;
  const isLocalMode = source === "local";

  if (loggedIn) {
    if (isLocalMode) {
      // In local mode, fire remote library sync in the background so boot is instant
      void syncYtMusicLibrary();
    } else {
      setInitStatus("Syncing YouTube Music...");
      await syncYtMusicLibrary();

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
