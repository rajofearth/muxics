// @ts-expect-error vite svg import
import appLogo from "../../../assets/muzics-dark.svg";
import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import {
  useAuthStore,
  INIT_STATUS_SESSION_REJECTED,
  INIT_STATUS_RECOVERING,
} from "../store/authStore";
import { AlertTriangle, RefreshCw, Music, Wifi } from "lucide-react";
import { bench } from "../bench";

export function SplashScreen() {
  const status = usePlayerStore((s) => s._initStatus);
  const scanProgress = useLibraryStore((s) => s.library.scanProgress);
  const libraryLoading = useLibraryStore((s) => s.library.loading);
  const sessionExpired = useAuthStore((s) => s.auth.sessionExpired);
  const recovering = useAuthStore((s) => s.auth.recovering);
  const setLibrarySource = useLibraryStore((s) => s.setLibrarySource);
  const setInitReady = usePlayerStore((s) => s.setInitReady);
  const cancelSessionRecovery = useAuthStore((s) => s.cancelSessionRecovery);

  const showProgress = libraryLoading && scanProgress > 0 && scanProgress < 100;

  // ── Bench: render:splash:<stage>:frame — post-frame (double rAF) after
  // each splash stage paint (design §2.3 mark set). Cancelled if the stage
  // changes before it paints, so superseded stages never leave marks.
  const prevSplashStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!status || status === prevSplashStatus.current) return;
    prevSplashStatus.current = status;
    if (!bench.enabled) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        bench.mark(`render:splash:${status}:frame`);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [status]);

  const isSessionRejected =
    status === INIT_STATUS_SESSION_REJECTED || sessionExpired;
  const isRecovering = status === INIT_STATUS_RECOVERING || recovering;

  // ---------- Session rejected / signed out state ----------
  if (isSessionRejected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 select-none px-8">
        {/* Animated alert icon */}
        <div className="relative animate-fade-in">
          <div className="w-18 h-18 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle size={30} className="text-red-400" />
          </div>
          <div className="absolute inset-0 bg-red-500/5 blur-xl rounded-2xl" />
        </div>

        {/* Heading */}
        <div className="text-center max-w-sm animate-slide-up">
          <h1 className="text-xl font-bold text-app-text-primary tracking-tight mb-2">
            Signed Out of YouTube Music
          </h1>
          <p className="text-[13px] text-app-text-secondary leading-relaxed">
            Your YouTube Music session has expired or is no longer valid.
            Reconnect by sending your session from the browser extension.
          </p>
        </div>

        {/* Steps card */}
        <div className="bg-app-elevated rounded-xl p-5 border border-app-border-strong w-full max-w-xs animate-slide-up">
          <h3 className="text-[13px] font-semibold text-app-text-primary mb-4 text-center">
            To reconnect:
          </h3>
          <ol className="space-y-3">
            <li className="flex items-start gap-3 text-[12px] text-app-text-secondary">
              <span className="shrink-0 w-5 h-5 rounded-full bg-app-text-primary/10 text-[11px] font-semibold text-app-text-primary flex items-center justify-center mt-0.5">
                1
              </span>
              <span>
                Make sure the{" "}
                <span className="text-app-accent font-medium">
                  Muxics Browser Extension
                </span>{" "}
                is installed in Chrome or Edge
              </span>
            </li>
            <li className="flex items-start gap-3 text-[12px] text-app-text-secondary">
              <span className="shrink-0 w-5 h-5 rounded-full bg-app-text-primary/10 text-[11px] font-semibold text-app-text-primary flex items-center justify-center mt-0.5">
                2
              </span>
              <span>
                Open{" "}
                <span className="text-app-accent font-medium">
                  music.youtube.com
                </span>{" "}
                and sign in to your account
              </span>
            </li>
            <li className="flex items-start gap-3 text-[12px] text-app-text-secondary">
              <span className="shrink-0 w-5 h-5 rounded-full bg-app-text-primary/10 text-[11px] font-semibold text-app-text-primary flex items-center justify-center mt-0.5">
                3
              </span>
              <span>
                Open the extension and click{" "}
                <span className="text-app-text-primary font-medium">
                  Send Session To Muxics
                </span>
              </span>
            </li>
          </ol>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 w-full max-w-xs animate-fade-in">
          <button
            onClick={() => {
              // Clear error and navigate to settings
              useAuthStore.setState((s) => ({
                auth: { ...s.auth, sessionExpired: false },
              }));
              useLibraryStore.setState((s) => ({
                library: { ...s.library, error: null },
              }));
              setInitReady();
              requestAnimationFrame(() => {
                document.dispatchEvent(
                  new CustomEvent("app-navigate", { detail: "settings" }),
                );
              });
            }}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-app-text-primary text-app-bg text-[13px] font-medium hover:opacity-90 transition-all"
          >
            <RefreshCw size={14} />
            Open Settings
          </button>
          <button
            onClick={() => {
              // Clear error and dismiss splash (guest mode)
              useAuthStore.setState((s) => ({
                auth: { ...s.auth, sessionExpired: false },
              }));
              useLibraryStore.setState((s) => ({
                library: { ...s.library, error: null },
              }));
              setInitReady();
            }}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-app-elevated text-app-text-primary text-[13px] font-medium hover:bg-app-active border border-app-border-strong transition-all"
          >
            <Wifi size={14} />
            Continue to Player (Guest Mode)
          </button>
          <button
            onClick={() => {
              // Switch to local-only mode and dismiss splash
              setLibrarySource("local");
              useLibraryStore.setState((s) => ({
                library: { ...s.library, error: null },
              }));
              setInitReady();
            }}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-app-elevated text-app-text-primary text-[13px] font-medium hover:bg-app-active border border-app-border-strong transition-all"
          >
            <Music size={14} />
            Continue with Local Files
          </button>
        </div>
      </div>
    );
  }

  // ---------- Auto-recovery in progress ----------
  if (isRecovering) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 select-none px-8">
        {/* Animated signal icon */}
        <div className="relative animate-fade-in">
          <div className="w-18 h-18 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
            <Wifi size={30} className="text-yellow-400 animate-pulse" />
          </div>
          <div className="absolute inset-0 bg-yellow-500/5 blur-xl rounded-2xl" />
        </div>

        {/* Heading */}
        <div className="text-center max-w-sm animate-slide-up">
          <h1 className="text-xl font-bold text-app-text-primary tracking-tight mb-2">
            Session Expired
          </h1>
          <p className="text-[13px] text-app-text-secondary leading-relaxed">
            Your YouTube Music session has expired. The app is trying to
            reconnect automatically using your browser extension...
          </p>
        </div>

        {/* Progress indicator */}
        <div className="bg-app-elevated rounded-xl p-5 border border-app-border-strong w-full max-w-xs animate-slide-up text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <RefreshCw size={16} className="text-app-accent animate-spin" />
            <span className="text-[13px] font-medium text-app-text-primary">
              Attempting to reconnect
            </span>
          </div>
          <p className="text-[11px] text-app-text-tertiary">
            Keep the browser extension active and signed into YouTube Music.
            <br />
            Auto-retrying for up to 30 seconds.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 w-full max-w-xs animate-fade-in">
          <button
            onClick={() => {
              cancelSessionRecovery();
              // Dismiss splash (guest mode)
              useAuthStore.setState((s) => ({
                auth: {
                  ...s.auth,
                  sessionExpired: false,
                  recovering: false,
                },
              }));
              useLibraryStore.setState((s) => ({
                library: { ...s.library, error: null },
              }));
              setInitReady();
            }}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-app-text-primary text-app-bg text-[13px] font-medium hover:opacity-90 transition-all"
          >
            <Wifi size={14} />
            Continue to Player (Guest Mode)
          </button>
          <button
            onClick={() => {
              cancelSessionRecovery();
              setLibrarySource("local");
              useLibraryStore.setState((s) => ({
                library: { ...s.library, error: null },
              }));
              setInitReady();
            }}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-app-elevated text-app-text-primary text-[13px] font-medium hover:bg-app-active border border-app-border-strong transition-all"
          >
            <Music size={14} />
            Continue with Local Files
          </button>
        </div>
      </div>
    );
  }

  // ---------- Normal splash screen ----------
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 select-none">
      {/* App logo */}
      <div className="relative">
        <div className="w-20 h-20 flex items-center justify-center">
          <img
            src={appLogo}
            alt="Muxics"
            className="w-full h-full object-contain"
          />
        </div>
        {/* Soft glow */}
        <div className="absolute inset-0 bg-app-accent/5 blur-xl rounded-2xl" />
      </div>

      {/* Title */}
      <div className="text-center">
        <h1 className="text-xl font-bold text-app-text-primary tracking-tight">
          Muxics
        </h1>
      </div>

      {/* Status text — always rendered to prevent layout shift */}
      <div className="h-5 flex items-center justify-center">
        {status && (
          <p className="text-[13px] text-app-text-secondary animate-fade-in">
            {status}
          </p>
        )}
      </div>

      {/* Animated indicator — three dots normally, percentage while scanning */}
      <div className="h-[14px] flex items-center justify-center">
        {showProgress ? (
          <span className="text-[13px] text-app-text-tertiary tabular-nums font-medium animate-fade-in">
            {scanProgress}%
          </span>
        ) : (
          <div className="flex items-center gap-1.5" aria-label="Loading">
            <span
              className="w-1.5 h-1.5 rounded-full bg-app-text-tertiary animate-pulse-soft"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-app-text-tertiary animate-pulse-soft"
              style={{ animationDelay: "300ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-app-text-tertiary animate-pulse-soft"
              style={{ animationDelay: "600ms" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
