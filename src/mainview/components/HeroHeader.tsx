import { memo } from "react";

type HeroHeaderProps = {
  title: string;
  subtitle: string;
  meta: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  gradient?: string;
};

export const HeroHeader = memo(function HeroHeader({
  title,
  subtitle,
  meta,
  icon,
  actions,
  gradient,
}: HeroHeaderProps) {
  return (
    <div className="relative shrink-0 overflow-hidden">
      {gradient && (
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: gradient }}
        />
      )}
      <div className="relative px-8 pt-8 pb-6">
        <div className="flex items-end gap-5">
          {icon && (
            <div className="w-32 h-32 rounded-xl bg-app-elevated shadow-lg flex items-center justify-center shrink-0 overflow-hidden">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1 pb-1">
            <div className="text-[11px] font-medium text-app-text-tertiary uppercase tracking-wider mb-1">
              {subtitle}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold text-app-text-primary tracking-tight leading-tight">
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
