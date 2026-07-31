import { useEffect } from "react";
import { getColorSync, getPaletteSync } from "colorthief";
import { usePlayerStore } from "../store/playerStore";
import { useUiStore } from "../store/uiStore";

const MIN_ACCENT_LUMINANCE = 0.25;

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

function adjustColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHex(
    Math.min(255, Math.floor(r * factor)),
    Math.min(255, Math.floor(g * factor)),
    Math.min(255, Math.floor(b * factor))
  );
}

function getLuminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function lightenToMinLuminance(r: number, g: number, b: number): [number, number, number] {
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const t = (low + high) / 2;
    const nr = r + (255 - r) * t;
    const ng = g + (255 - g) * t;
    const nb = b + (255 - b) * t;
    if (getLuminance(nr, ng, nb) >= MIN_ACCENT_LUMINANCE) high = t;
    else low = t;
  }
  const t = (low + high) / 2;
  const clamp = (v: number) => Math.min(255, Math.round(v));
  return [clamp(r + (255 - r) * t), clamp(g + (255 - g) * t), clamp(b + (255 - b) * t)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBestAccentColor(img: HTMLImageElement): string | null {
  const dominant = getColorSync(img)?.array() ?? null;
  if (!dominant) return null;

  const [r, g, b] = dominant;
  const lum = getLuminance(r, g, b);

  if (lum >= MIN_ACCENT_LUMINANCE) return rgbToHex(r, g, b);

  const palette = getPaletteSync(img, { colorCount: 5 })?.map((color) => color.array()) ?? null;
  if (palette?.length) {
    const candidates = palette
      .map((c: [number, number, number]) => ({ rgb: c, lum: getLuminance(c[0], c[1], c[2]) }))
      .filter((c: { lum: number }) => c.lum >= MIN_ACCENT_LUMINANCE)
      .sort((a: { lum: number }, b: { lum: number }) => b.lum - a.lum);
    if (candidates.length) {
      const [dr, dg, db] = candidates[0].rgb;
      return rgbToHex(dr, dg, db);
    }
  }

  const [lr, lg, lb] = lightenToMinLuminance(r, g, b);
  return rgbToHex(lr, lg, lb);
}

export function useThemeFromArt() {
  const currentTrack = usePlayerStore((s) => s.player.currentTrack);
  const updateTheme = useUiStore((s) => s.updateTheme);
  const resetTheme = useUiStore((s) => s.resetTheme);

  useEffect(() => {
    if (!currentTrack?.picture) {
      resetTheme();
      return;
    }

    const img = new Image();
    if (!currentTrack.picture.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }

    const onLoad = () => {
      try {
        const accent = pickBestAccentColor(img);
        if (accent) {
          const palette = [accent, adjustColor(accent, 0.85), adjustColor(accent, 0.6)];
          updateTheme(accent, palette);
        } else {
          resetTheme();
        }
      } catch {
        resetTheme();
      }
    };

    img.onerror = resetTheme;
    img.src = currentTrack.picture;
    if (img.complete) onLoad();
    else img.addEventListener("load", onLoad);

    return () => img.removeEventListener("load", onLoad);
  }, [currentTrack?.picture, currentTrack?.id, updateTheme, resetTheme]);
}
