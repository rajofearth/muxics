import { Dialog } from "./Dialog";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  const confirmClass =
    variant === "danger"
      ? "rounded-full bg-red-500 px-4 py-2 text-white hover:bg-red-400"
      : "rounded-full bg-white px-4 py-2 text-slate-950 hover:opacity-95";

  return (
    <Dialog title={title} onClose={onClose} maxWidth="lg">
      <p className="mb-6 min-w-0 break-words text-sm text-white/60">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-white/45 transition hover:text-white"
        >
          {cancelLabel}
        </button>
        <button type="button" onClick={handleConfirm} className={confirmClass}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
