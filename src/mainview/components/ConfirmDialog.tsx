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

  return (
    <Dialog title={title} onClose={onClose} maxWidth="sm">
      <p className="text-[13px] text-app-text-secondary mb-6 break-words">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13px] text-app-text-secondary hover:text-app-text-primary rounded-lg hover:bg-app-hover"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={`px-4 py-2 text-[13px] font-medium rounded-lg ${
            variant === "danger"
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-app-text-primary text-app-bg hover:opacity-90"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
