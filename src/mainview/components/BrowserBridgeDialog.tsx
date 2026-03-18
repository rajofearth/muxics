import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";

type BrowserBridgeDialogProps = {
  loading: boolean;
  error: string | null;
  extensionId: string | null;
  folderPath: string | null;
  zipPath: string | null;
  onClose: () => void;
  onPrepareBundle: () => void;
  onOpenPath: (path: string) => void;
  onRefresh: () => void;
};

export function BrowserBridgeDialog({
  loading,
  error,
  extensionId,
  folderPath,
  zipPath,
  onClose,
  onPrepareBundle,
  onOpenPath,
  onRefresh,
}: BrowserBridgeDialogProps) {
  return (
    <Dialog title="Connect Browser" onClose={onClose} maxWidth="lg">
      <div className="space-y-4">
        <p className="text-[13px] text-app-text-secondary">
          This flow installs a local browser bridge so users can connect their existing YouTube Music browser session
          without pasting cookies manually.
        </p>

        <div className="rounded-xl border border-app-border bg-app-surface-alt px-4 py-3 text-[12px] text-app-text-secondary">
          <div className="font-medium text-app-text-primary">Setup steps</div>
          <div className="mt-1">1. Keep the Muxics app running.</div>
          <div>2. Download or open the unpacked extension files.</div>
          <div>3. In Chrome/Edge, open the extensions page, enable Developer Mode, and click Load unpacked.</div>
          <div>4. Pick the extracted extension folder.</div>
          <div>5. Open the extension and click “Send Session To Muxics”.</div>
          <div>6. Return here and click Refresh Connection.</div>
        </div>

        {extensionId ? (
          <div className="rounded-xl border border-app-border bg-app-elevated px-4 py-3 text-[12px] text-app-text-secondary">
            <div className="font-medium text-app-text-primary">Extension ID</div>
            <div className="mt-1 break-all">{extensionId}</div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrepareBundle}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-app-text-primary px-4 py-2 text-[13px] font-medium text-app-bg hover:opacity-90 disabled:opacity-60"
          >
            <Download size={14} />
            Prepare Extension Files
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active disabled:opacity-60"
          >
            <RefreshCw size={14} />
            Refresh Connection
          </button>
        </div>

        {zipPath || folderPath ? (
          <div className="flex flex-wrap items-center gap-2">
            {zipPath ? (
              <button
                type="button"
                onClick={() => onOpenPath(zipPath)}
                className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active"
              >
                <FolderOpen size={14} />
                Open ZIP
              </button>
            ) : null}
            {folderPath ? (
              <button
                type="button"
                onClick={() => onOpenPath(folderPath)}
                className="inline-flex items-center gap-2 rounded-xl bg-app-elevated px-4 py-2 text-[13px] text-app-text-primary hover:bg-app-active"
              >
                <FolderOpen size={14} />
                Open Extension Folder
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
