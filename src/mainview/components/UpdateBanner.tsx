import { useEffect, useState } from "react";
import { Download, RefreshCw, X, AlertCircle, CheckCircle2 } from "lucide-react";
import type { AutoUpdateStatus } from "../../shared/desktop-contract";
import { usePlayerStore } from "../store/playerStore";

export function UpdateBanner() {
  const [status, setStatus] = useState<AutoUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const rpc = usePlayerStore((s) => s.rpc);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent<AutoUpdateStatus>).detail;
      setStatus(detail);
      
      // Auto-dismiss errors after 10 seconds or "not-available" after 5s
      if (detail.status === "error") {
        setTimeout(() => setDismissed(true), 10000);
      } else if (detail.status === "not-available") {
        setTimeout(() => setDismissed(true), 5000);
      } else {
        setDismissed(false);
      }
    };

    document.addEventListener("muxics-auto-update", handleUpdate);
    return () => document.removeEventListener("muxics-auto-update", handleUpdate);
  }, []);

  if (!status || dismissed || status.status === "checking") {
    return null;
  }

  const handleInstall = () => {
    if (rpc) {
      rpc.request.installUpdate();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (status.status === "error" || status.status === "not-available") {
    const isError = status.status === "error";
    return (
      <div className={`flex items-center justify-between px-4 py-2 text-[13px] font-medium border-b shrink-0 animate-fade-in ${
        isError ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-app-surface text-app-text-secondary border-app-border"
      }`}>
        <div className="flex items-center gap-2">
          {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{isError ? `Update failed: ${status.message}` : "Muxics is up to date"}</span>
        </div>
        <button onClick={handleDismiss} className="p-1 hover:bg-black/20 rounded-md transition-colors">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-app-accent/10 border-b border-app-accent/20 text-app-text-primary shrink-0 animate-fade-in relative z-50 shadow-md">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-app-accent/20 rounded-lg text-app-accent shadow-sm">
          {status.status === "downloading" ? (
            <Download size={16} className="animate-bounce" />
          ) : (
            <RefreshCw size={16} className="animate-pulse" />
          )}
        </div>
        
        <div>
          <div className="text-[13px] font-semibold text-white">
            {status.status === "available" && `Update v${status.version} available`}
            {status.status === "downloading" && `Downloading update...`}
            {status.status === "downloaded" && `Update v${status.version} is ready`}
          </div>
          {status.status === "downloading" && (
            <div className="flex items-center gap-2 mt-1">
              <div className="w-32 h-1.5 bg-black/40 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-app-accent transition-all duration-300 ease-out" 
                  style={{ width: `${status.percent}%` }}
                />
              </div>
              <span className="text-[11px] text-app-text-secondary font-medium tabular-nums shadow-sm">
                {status.percent}%
              </span>
            </div>
          )}
          {status.status === "available" && (
            <div className="text-[12px] text-app-text-secondary mt-0.5">
              Downloading in background...
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {status.status === "downloaded" && (
          <button 
            onClick={handleInstall}
            className="px-3 py-1.5 bg-app-accent text-white hover:bg-app-accent-hover text-[12px] font-bold rounded-lg shadow-md hover:shadow-lg transition-all"
          >
            Restart to Update
          </button>
        )}
        {(status.status === "available" || status.status === "downloaded") && (
          <button 
            onClick={handleDismiss}
            className="p-1.5 text-app-text-tertiary hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
