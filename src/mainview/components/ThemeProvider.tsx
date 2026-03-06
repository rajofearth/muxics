import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = usePlayerStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-app-accent", theme.accentColor);
    root.style.setProperty("--color-app-accent-dim", theme.accentColor + "33");
  }, [theme.accentColor, theme.palette]);

  return <>{children}</>;
}
