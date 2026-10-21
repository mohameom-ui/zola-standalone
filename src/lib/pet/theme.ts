// THEME — her appearance settings. One module owns the vocabulary: five
// accent palettes, glow strength, and a calm mode. The values land as CSS
// variables on her panel root (--z-*) so every button, panel, chip, and the
// 3D halo speak the same color language. Persisted locally, of course.

export interface ZolaTheme {
  a: string;      // primary accent — her gold slot
  b: string;      // secondary accent — her sovereign green slot
  warn: string;   // warm warnings
  info: string;   // cool info
  danger: string; // alarms
  glow: number;   // panel glow alpha (0 = off .. 66 = loud)
  calm: boolean;  // reduced motion — no pings, no pulses
}

export const THEME_PRESETS: Record<string, Omit<ZolaTheme, "glow" | "calm">> = {
  AURORA: { a: "#f0b90b", b: "#35d0a5", warn: "#ff9f43", info: "#5ac8fa", danger: "#ff4d4f" },
  EMBER:  { a: "#ff9f43", b: "#f0b90b", warn: "#ff6b6b", info: "#ffd166", danger: "#ff4d4f" },
  ICE:    { a: "#5ac8fa", b: "#35d0a5", warn: "#f0b90b", info: "#a78bfa", danger: "#ff4d4f" },
  VIOLET: { a: "#b98cf0", b: "#5ac8fa", warn: "#ff9f43", info: "#f0b90b", danger: "#ff4d4f" },
  ROSE:   { a: "#ff6b8a", b: "#f0b90b", warn: "#ffb86b", info: "#5ac8fa", danger: "#ff4d4f" },
};

const KEY = "zola_theme_v1";

export function loadTheme(): ZolaTheme {
  const fallback: ZolaTheme = { ...THEME_PRESETS.AURORA, glow: 33, calm: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<ZolaTheme>;
    const presetName = (Object.keys(THEME_PRESETS) as (keyof typeof THEME_PRESETS)[])
      .find((n) => THEME_PRESETS[n].a === saved.a);
    const base: ZolaTheme = presetName
      ? { ...THEME_PRESETS[presetName], glow: fallback.glow, calm: false }
      : {
          a: saved.a ?? fallback.a,
          b: saved.b ?? fallback.b,
          warn: saved.warn ?? fallback.warn,
          info: saved.info ?? fallback.info,
          danger: saved.danger ?? fallback.danger,
          glow: fallback.glow,
          calm: false,
        };
    return {
      ...base,
      glow: typeof saved.glow === "number" ? saved.glow : base.glow,
      calm: !!saved.calm,
    };
  } catch {
    return fallback;
  }
}

export function saveTheme(t: ZolaTheme): void {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* best-effort */ }
}

export function themeVars(t: ZolaTheme): Record<string, string> {
  return {
    "--z-a": t.a,
    "--z-b": t.b,
    "--z-warn": t.warn,
    "--z-info": t.info,
    "--z-danger": t.danger,
    "--z-glow-alpha": String(t.glow).padStart(2, "0"),
  };
}
