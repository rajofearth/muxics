// authStore — IPC bridge reference, auth state machine, login/logout
import { create } from "zustand";
import type {
  AuthStatus,
  PendingAuthLogin,
} from "../types";
import { useLibraryStore } from "./libraryStore";
import type {
  AuthLoginStartResult,
  AuthStatusResult,
  DesktopBridge,
} from "../../shared/desktop-contract";

export const INIT_STATUS_SESSION_REJECTED = "session_rejected";
export const INIT_STATUS_RECOVERING = "session_recovering";

const SESSION_RECOVERY_TIMEOUT_MS = 30_000;
const SESSION_RECOVERY_POLL_MS = 2_000;

let sessionRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

export interface AuthState {
  rpc: DesktopBridge | null;
  auth: AuthStatus;
  authLogin: {
    pending: PendingAuthLogin | null;
    loading: boolean;
    error: string | null;
  };
}

export interface AuthActions {
  setRpc: (rpc: DesktopBridge | null) => void;
  setLastSyncedAt: (lastSyncedAt: number) => void;
  loadAuthStatus: () => Promise<void>;
  loginToYtMusic: () => Promise<void>;
  importYtMusicSession: (cookie: string) => Promise<boolean>;
  completeYtMusicLogin: () => Promise<void>;
  cancelYtMusicLogin: () => Promise<void>;
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
    pending: null,
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
        ? { pending: null, loading: false, error: null }
        : s.authLogin,
    }));
  },

  loginToYtMusic: async () => {
    const { rpc } = get();
    if (!rpc) return;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result: AuthLoginStartResult = await rpc.request.authLogin();

    if (result.kind === "pending_verification") {
      set(() => ({
        authLogin: {
          pending: {
            verificationUrl: result.verificationUrl,
            userCode: result.userCode,
            expiresAt: result.expiresAt,
            pollIntervalMs: result.pollIntervalMs,
          },
          loading: false,
          error: null,
        },
      }));
      return;
    }

    if (result.kind === "completed" || result.kind === "already_logged_in") {
      const auth = result.auth;
      set({
        auth: { ...auth, sessionExpired: false },
        authLogin: { pending: null, loading: false, error: null },
      });

      if (auth.loggedIn) {
        void useLibraryStore.getState().hydrateYtMusicFromCache();
        void useLibraryStore.getState().syncYtMusicLibrary();
      }
      return;
    }

    set(() => ({
      authLogin: { pending: null, loading: false, error: result.message },
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

    set(() => ({
      auth: { ...result.auth!, sessionExpired: false, recovering: false },
      authLogin: { pending: null, loading: false, error: null },
    }));

    void useLibraryStore.getState().hydrateYtMusicFromCache();
    void useLibraryStore.getState().syncYtMusicLibrary();
    return true;
  },

  completeYtMusicLogin: async () => {
    const { rpc, authLogin } = get();
    if (!rpc || !authLogin.pending) return;

    set((s) => ({
      authLogin: { ...s.authLogin, loading: true, error: null },
    }));

    const result = await rpc.request.authCompleteLogin();
    if (result.kind === "completed") {
      set(() => ({
        auth: { ...result.auth, sessionExpired: false },
        authLogin: { pending: null, loading: false, error: null },
      }));
      void useLibraryStore.getState().hydrateYtMusicFromCache();
      void useLibraryStore.getState().syncYtMusicLibrary();
      return;
    }

    set((s) => ({
      authLogin: {
        pending: s.authLogin.pending,
        loading: false,
        error: result.message,
      },
    }));
  },

  cancelYtMusicLogin: async () => {
    const { rpc } = get();
    if (!rpc) return;

    await rpc.request.authCancelLogin();
    set(() => ({
      authLogin: { pending: null, loading: false, error: null },
    }));
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

    const auth = await rpc.request.authLogout();
    set(() => ({
      auth: { ...auth, sessionExpired: false, recovering: false },
      authLogin: { pending: null, loading: false, error: null },
    }));

    useLibraryStore.getState().resetRemoteLibrary();
  },

  startSessionRecovery: async () => {
    // Clear any previous recovery timer
    if (sessionRecoveryTimer !== null) {
      clearTimeout(sessionRecoveryTimer);
      sessionRecoveryTimer = null;
    }

    const { rpc, auth } = get();
    if (!rpc || auth.recovering) return;

    const initialUpdatedAt = auth.sessionUpdatedAt;

    set((s) => ({
      auth: {
        ...s.auth,
        sessionExpired: false,
        recovering: true,
      },
    }));

    const startedAt = Date.now();

    const poll = async () => {
      if (!get().auth.recovering) return; // Recovery was cancelled

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
        if (status.loggedIn && status.sessionUpdatedAt !== initialUpdatedAt) {
          // Extension refreshed the session — recovery succeeded!
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
