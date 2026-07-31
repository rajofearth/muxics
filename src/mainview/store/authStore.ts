// authStore — IPC bridge reference, auth state machine, login/logout
import { create } from "zustand";
import type {
  AuthStatus,
} from "../types";
import { useLibraryStore } from "./libraryStore";
import type {
  AuthStatusResult,
  DesktopBridge,
} from "../../shared/desktop-contract";

export const INIT_STATUS_SESSION_REJECTED = "session_rejected";
export const INIT_STATUS_RECOVERING = "session_recovering";

const SESSION_RECOVERY_TIMEOUT_MS = 30_000;
const SESSION_RECOVERY_POLL_MS = 2_000;

let sessionRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let sessionRecoveryGeneration = 0;

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

export interface AuthState {
  rpc: DesktopBridge | null;
  auth: AuthStatus;
  authLogin: {
    loading: boolean;
    error: string | null;
  };
}

export interface AuthActions {
  setRpc: (rpc: DesktopBridge | null) => void;
  setLastSyncedAt: (lastSyncedAt: number) => void;
  loadAuthStatus: () => Promise<void>;
  importYtMusicSession: (cookie: string) => Promise<boolean>;
  clearAuthLoginError: () => void;
  logoutFromYtMusic: () => Promise<void>;
  startSessionRecovery: () => Promise<void>;
  cancelSessionRecovery: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState & AuthActions>()((set, get) => ({
  rpc: null,
  auth: {
    loggedIn: false,
    sessionExpired: false,
    recovering: false,
    provider: "ytmusic",
    persistent: false,
  },
  authLogin: {
    loading: false,
    error: null,
  },

  setRpc: (rpc) => set({ rpc }),
  setLastSyncedAt: (lastSyncedAt) => set((s) => ({ auth: { ...s.auth, lastSyncedAt, loggedIn: true } })),

  loadAuthStatus: async () => {
    const { rpc } = get();
    if (!rpc) return;

    const auth: AuthStatusResult = await rpc.request.authGetStatus();
    set((s) => ({
      auth: {
        ...auth,
        sessionExpired: auth.loggedIn ? s.auth.sessionExpired : false,
      },
      authLogin: auth.loggedIn
        ? { loading: false, error: null }
        : s.authLogin,
    }));
  },

  importYtMusicSession: async (cookie) => {
    const { rpc } = get();
    if (!rpc) return false;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result = await rpc.request.authImportSession({ cookie });
    if (!result.success || !result.auth) {
      set((s) => ({
        authLogin: {
          ...s.authLogin,
          loading: false,
          error: result.error ?? "Failed to import YouTube Music session.",
        },
      }));
      return false;
    }

    // Cancel any active session recovery since we have fresh credentials
    if (sessionRecoveryTimer !== null) {
      clearTimeout(sessionRecoveryTimer);
      sessionRecoveryTimer = null;
    }
    sessionRecoveryGeneration++;

    set(() => ({
      auth: { ...result.auth!, sessionExpired: false, recovering: false },
      authLogin: { loading: false, error: null },
    }));

    void useLibraryStore.getState().hydrateYtMusicFromCache();
    void useLibraryStore.getState().syncYtMusicLibrary();
    return true;
  },

  clearAuthLoginError: () => {
    set((s) => ({
      authLogin: { ...s.authLogin, error: null },
    }));
  },

  logoutFromYtMusic: async () => {
    const { rpc } = get();
    if (!rpc) return;

    // Cancel any active session recovery
    if (sessionRecoveryTimer !== null) {
      clearTimeout(sessionRecoveryTimer);
      sessionRecoveryTimer = null;
    }
    sessionRecoveryGeneration++;

    const auth = await rpc.request.authLogout();
    set(() => ({
      auth: { ...auth, sessionExpired: false, recovering: false },
      authLogin: { loading: false, error: null },
    }));

    useLibraryStore.getState().resetRemoteLibrary();
  },

  startSessionRecovery: async () => {
    // Clear any previous recovery timer
    if (sessionRecoveryTimer !== null) {
      clearTimeout(sessionRecoveryTimer);
      sessionRecoveryTimer = null;
    }
    const generation = ++sessionRecoveryGeneration;

    const { rpc, auth } = get();
    if (!rpc || auth.recovering) return;

    set((s) => ({
      auth: {
        ...s.auth,
        sessionExpired: false,
        recovering: true,
      },
    }));

    const startedAt = Date.now();

    const poll = async () => {
      if (generation !== sessionRecoveryGeneration || !get().auth.recovering) return; // Recovery was cancelled

      const elapsed = Date.now() - startedAt;
      if (elapsed >= SESSION_RECOVERY_TIMEOUT_MS) {
        // Recovery timed out — surface the expired session
        set((s) => ({
          auth: {
            ...s.auth,
            sessionExpired: true,
            recovering: false,
          },
        }));
        return;
      }

      try {
        const status = await rpc.request.authGetStatus();
        if (generation !== sessionRecoveryGeneration || !get().auth.recovering) return;
        if (status.loggedIn) {
          // Recovery succeeded. The backend only reports loggedIn when it can
          // build a working Innertube client from the stored session, and the
          // rejected session was already cleared synchronously before the sync
          // error reached us — so loggedIn here necessarily means the
          // extension wrote a fresh, valid session. We must not require a
          // sessionUpdatedAt change: a cookie refresh can rewrite the same
          // session without bumping updatedAt.
          set(() => ({
            auth: {
              ...status,
              sessionExpired: false,
              recovering: false,
            },
          }));

          void useLibraryStore.getState().hydrateYtMusicFromCache();
          void useLibraryStore.getState().syncYtMusicLibrary();
          
          // Dismiss the splash screen and transition to main player
          const { usePlayerStore } = await import("./playerStore");
          usePlayerStore.getState().setInitReady();
          return;
        }
      } catch {
        // Poll failed, will retry
      }

      // Schedule next poll
      sessionRecoveryTimer = setTimeout(poll, SESSION_RECOVERY_POLL_MS);
    };

    // Start polling
    sessionRecoveryTimer = setTimeout(poll, SESSION_RECOVERY_POLL_MS);
  },

  cancelSessionRecovery: () => {
    if (sessionRecoveryTimer !== null) {
      clearTimeout(sessionRecoveryTimer);
      sessionRecoveryTimer = null;
    }
    sessionRecoveryGeneration++;
    set((s) => ({
      auth: {
        ...s.auth,
        recovering: false,
      },
    }));
  },
}));

// ---------------------------------------------------------------------------
// Public getter — lets other stores access the rpc bridge without subscribing
// ---------------------------------------------------------------------------
export const getRpc = () => useAuthStore.getState().rpc;
