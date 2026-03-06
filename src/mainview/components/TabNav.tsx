import { memo } from "react";

type TabNavProps = {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
};

export const TabNav = memo(function TabNav({ tabs, activeTab, onTabChange }: TabNavProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="shrink-0 border-b border-app-border bg-app-bg/90 backdrop-blur-sm px-8 overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto py-1 -mb-px">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all shrink-0 ${
              activeTab === tab
                ? "bg-app-active text-app-text-primary"
                : "text-app-text-tertiary hover:text-app-text-secondary hover:bg-app-hover"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
});
