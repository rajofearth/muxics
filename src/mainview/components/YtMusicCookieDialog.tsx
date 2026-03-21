import { useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { Dialog } from "./Dialog";

type YtMusicCookieDialogProps = {
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (cookie: string) => void;
  onOpenHelp: () => void;
};

export function YtMusicCookieDialog({
  loading,
  error,
  onClose,
  onSubmit,
  onOpenHelp,
}: YtMusicCookieDialogProps) {
  const [cookie, setCookie] = useState("");

  return (
    <Dialog title="Connect YouTube Music" onClose={onClose} maxWidth="lg">
      <div className="space-y-4">
        <p className="text-[13px] text-app-text-secondary">
          Sign in to <span className="text-app-text-primary">music.youtube.com</span> in your regular browser, then
          paste the full <span className="text-app-text-primary">Cookie</span> header from an authenticated request.
        </p>

        <div className="rounded-xl border border-app-border bg-app-surface-alt px-4 py-3 text-[12px] text-app-text-secondary">
          <div className="font-medium text-app-text-primary">Quick steps</div>
          <div className="mt-1">1. Open YouTube Music in your browser and make sure you are logged in.</div>
          <div>2. Open DevTools, inspect any request to `music.youtube.com` or `www.youtube.com`.</div>
          <div>3. Copy the full `Cookie` request header value and paste it below.</div>
        </div>

        <textarea
          value={cookie}
          onChange={(event) => setCookie(event.target.value)}
          placeholder="Paste Cookie header value here"
          aria-label="YouTube Music Cookie header"
          className="min-h-44 w-full rounded-xl border border-app-border bg-app-elevated px-4 py-3 text-[12px] text-app-text-primary outline-none focus:border-app-border-strong"
        />

        {error ? (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSubmit(cookie)}
            disabled={loading || !cookie?.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg hover:opacity-90 disabled:opacity-60"
          >
            <KeyRound size={14} />
            {loading ? "Validating..." : "Import Session"}
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active"
          >
            <ExternalLink size={14} />
            Open YouTube Music
          </button>
        </div>
      </div>
    </Dialog>
  );
}
