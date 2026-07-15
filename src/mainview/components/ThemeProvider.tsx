import { useEffect } from "react";
import { useUiStore } from "../store/uiStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const themeName = useUiStore((s) => s.themeName);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-app-accent", theme.accentColor);
    root.style.setProperty("--color-app-accent-dim", theme.accentColor + "33");
  }, [theme.accentColor, theme.palette]);

  useEffect(() => {
    const root = document.documentElement;
    if (themeName === "default") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", themeName);
    }
  }, [themeName]);

  return <>{children}</>;
}
