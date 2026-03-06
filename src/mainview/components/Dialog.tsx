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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(2,5,10,0.72)] px-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className={`max-h-[90vh] w-full overflow-y-auto rounded-[30px] border border-white/10 bg-[rgba(10,16,26,0.96)] p-6 shadow-[0_30px_120px_rgba(2,6,16,0.5)] ${maxWidthClass[maxWidth]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="dialog-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-white/40 transition hover:bg-white/8 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
