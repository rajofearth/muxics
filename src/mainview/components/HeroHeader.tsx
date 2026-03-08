import { memo } from "react";
import { ChevronLeft } from "lucide-react";

type HeroHeaderProps = {
  title: string;
  subtitle: string;
  meta: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  gradient?: string;
  onBack?: () => void;
};

export const HeroHeader = memo(function HeroHeader({
  title,
  subtitle,
  meta,
  icon,
  actions,
  gradient,
  onBack,
}: HeroHeaderProps) {
  return (
    <div className="relative shrink-0 overflow-hidden">
      {gradient && (
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: gradient }}
        />
      )}
      <div className="relative px-8 pt-6 pb-6">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[12px] text-app-text-tertiary hover:text-app-text-primary mb-3 -ml-1 group"
          >
            <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
            Back
          </button>
        )}
        <div className="flex items-end gap-5">
          {icon && (
            <div className="w-28 h-28 rounded-xl bg-app-elevated shadow-lg flex items-center justify-center shrink-0 overflow-hidden">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1 pb-1">
            <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-1">
              {subtitle}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-app-text-primary tracking-tight leading-tight">
                {title}
              </h1>
              {actions}
            </div>
            <div className="text-[13px] text-app-text-secondary mt-1.5">{meta}</div>
          </div>
        </div>
      </div>
    </div>
  );
});
