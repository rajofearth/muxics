import { createPortal } from "react-dom";
import { X } from "lucide-react";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg";
};

const maxWidthClass = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Dialog({ title, onClose, children, maxWidth = "md" }: DialogProps) {
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999] animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className={`bg-app-surface border border-app-border p-6 w-full mx-4 max-h-[90vh] overflow-y-auto ${maxWidthClass[maxWidth]} rounded-2xl shadow-2xl animate-slide-up`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id="dialog-title" className="text-[15px] font-semibold text-app-text-primary">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-app-text-tertiary hover:text-app-text-primary p-1 rounded-lg hover:bg-app-hover"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
