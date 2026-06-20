// @ts-expect-error vite svg import
import appLogo from "../../../assets/muzics-dark.svg";
import { usePlayerStore } from "../store/playerStore";

export function SplashScreen() {
  const status = usePlayerStore((s) => s._initStatus);
  const scanProgress = usePlayerStore((s) => s.library.scanProgress);
  const libraryLoading = usePlayerStore((s) => s.library.loading);

  const showProgress = libraryLoading && scanProgress > 0 && scanProgress < 100;

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
