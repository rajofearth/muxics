import { useEffect, useState, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { Check, AlertCircle, Music, Heart, ListMusic } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  icon?: "favorite" | "playlist" | "queue";
}

let toastId = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function showToast(message: string, type: ToastType = "success", icon?: ToastItem["icon"]) {
  const item: ToastItem = { id: ++toastId, message, type, icon };
  listeners.forEach((fn) => fn(item));
}

const ICONS = {
  favorite: Heart,
  playlist: ListMusic,
  queue: Music,
};

const SingleToast = memo(function SingleToast({
  item,
  onDone,
}: {
  item: ToastItem;
  onDone: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDone(item.id), 200);
    }, 2800);
    return () => clearTimeout(timer);
  }, [item.id, onDone]);

  const IconComponent = item.icon ? ICONS[item.icon] : item.type === "error" ? AlertCircle : Check;

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border backdrop-blur-xl text-[13px] transition-all duration-200 ${
        visible && !exiting ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      } ${
        item.type === "error"
          ? "bg-red-950/90 border-red-900/50 text-red-200"
          : "bg-app-surface/90 border-app-border-strong text-app-text-primary"
      }`}
    >
      <IconComponent
        size={14}
        className={`shrink-0 ${
          item.type === "error" ? "text-red-400" : item.icon === "favorite" ? "text-app-accent fill-current" : "text-app-accent"
        }`}
      />
      <span className="flex-1 min-w-0 truncate">{item.message}</span>
    </div>
  );
});

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (t: ToastItem) => {
      setToasts((prev) => [...prev.slice(-3), t]);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const handleDone = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[10001] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <SingleToast key={t.id} item={t} onDone={handleDone} />
      ))}
    </div>,
    document.body
  );
}
