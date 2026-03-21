import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import type { PendingAuthLogin } from "../types";
import { Dialog } from "./Dialog";

type YtMusicLoginDialogProps = {
  pending: PendingAuthLogin;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onAwaitCompletion: () => void;
  onOpenExternal: (url: string) => void;
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function YtMusicLoginDialog({
  pending,
  loading,
  error,
  onClose,
  onRetry,
  onAwaitCompletion,
  onOpenExternal,
}: YtMusicLoginDialogProps) {
  const [now, setNow] = useState(() => Date.now());
  const startedCodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const onOpenExternalRef = useRef(onOpenExternal);
  onOpenExternalRef.current = onOpenExternal;
  const onAwaitCompletionRef = useRef(onAwaitCompletion);
  onAwaitCompletionRef.current = onAwaitCompletion;

  useEffect(() => {
    if (startedCodesRef.current.has(pending.userCode)) {
      return;
    }

    startedCodesRef.current.add(pending.userCode);
    try {
      const parsed = new URL(pending.verificationUrl);
      if (parsed.protocol === "https:") {
        onOpenExternalRef.current(pending.verificationUrl);
      }
    } catch (err) {
      console.error("Invalid verification URL:", pending.verificationUrl, err);
    }
    onAwaitCompletionRef.current();
  }, [pending.userCode, pending.verificationUrl]);

  const remainingText = useMemo(
    () => formatRemaining(pending.expiresAt - now),
    [now, pending.expiresAt],
  );

  const isExpired = now >= pending.expiresAt;

  return (
    <Dialog title="Sign In To YouTube Music" onClose={onClose}>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[13px] text-app-text-secondary">
            Finish sign-in in your browser using this code. The app will connect automatically once Google confirms it.
          </p>
          <div className="rounded-2xl border border-app-border bg-app-elevated px-4 py-5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-app-text-tertiary">
              Verification Code
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-[0.32em] text-app-text-primary">
              {pending.userCode}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-app-border bg-app-surface-alt px-4 py-3 text-[12px] text-app-text-secondary">
          <div className="font-medium text-app-text-primary">Open this URL in your browser</div>
          <div className="mt-1 break-all">{pending.verificationUrl}</div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-app-elevated px-4 py-3 text-[12px]">
          <span className="text-app-text-secondary">
            {isExpired ? "Code expired" : `Code expires in ${remainingText}`}
          </span>
          {loading ? (
            <span className="inline-flex items-center gap-2 text-app-text-primary">
              <LoaderCircle size={14} className="animate-spin" />
              Waiting for verification
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                const parsed = new URL(pending.verificationUrl);
                if (parsed.protocol === "https:") {
                  onOpenExternal(pending.verificationUrl);
                }
              } catch (err) {
                console.error("Invalid verification URL:", pending.verificationUrl, err);
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg hover:opacity-90"
          >
            <ExternalLink size={14} />
            Open Browser
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(pending.userCode).catch((err) => {
                console.error("Failed to copy code to clipboard:", err);
              });
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active"
          >
            <Copy size={14} />
            Copy Code
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active"
          >
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      </div>
    </Dialog>
  );
}
