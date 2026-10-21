// SETTINGS.TS — the persistent user settings (v4.2)
// Everything the user sets persists across page reloads. The OWNER sets the
// baseline defaults; regular users can override per-session but the owner's
// setting survives browser clears (it's stored under a separate key).
//
// Two storage tiers:
//   OWNER LOCK (localStorage "zola_owner_lock") — the owner's choices,
//     survives everything including "reset to defaults"
//   USER SETTINGS (localStorage "zola_user_settings") — the user's choices,
//     survives page reloads but can be reset to the owner lock

export interface ZolaSettings {
  modeName: string;       // which of the 500 modes she's in
  mood: string;           // her current emotional state
  voiceId: string;        // her Kokoro voice
  accentColor: string;    // her LED ring / accent color
  autoRotate: boolean;    // whether the brain rotates modes autonomously
  speakVerbose: boolean;  // whether she gives long or short answers
  spontaneousMoves: boolean; // whether she moves herself when idle
  theme: "dark" | "light";
}

const USER_KEY = "zola_user_settings_v1";
const OWNER_KEY = "zola_owner_lock_v1";

const DEFAULTS: ZolaSettings = {
  modeName: "Happy Loopy",
  mood: "curious",
  voiceId: "",
  accentColor: "#35d0a5",
  autoRotate: false,
  speakVerbose: false,
  spontaneousMoves: true,
  theme: "dark",
};

function readUser(): Partial<ZolaSettings> {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "{}") as Partial<ZolaSettings>;
  } catch {
    return {};
  }
}

function readOwner(): Partial<ZolaSettings> {
  try {
    return JSON.parse(localStorage.getItem(OWNER_KEY) ?? "{}") as Partial<ZolaSettings>;
  } catch {
    return {};
  }
}

function writeUser(s: Partial<ZolaSettings>): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(s));
  } catch { /* best-effort */ }
}

function writeOwner(s: Partial<ZolaSettings>): void {
  try {
    localStorage.setItem(OWNER_KEY, JSON.stringify(s));
  } catch { /* best-effort */ }
}

/** Load the effective settings: user overrides → owner lock → defaults. */
export function loadSettings(): ZolaSettings {
  const owner = readOwner();
  const user = readUser();
  return { ...DEFAULTS, ...owner, ...user };
}

/** Set a user setting (persists across reloads). */
export function setUserSetting<K extends keyof ZolaSettings>(key: K, value: ZolaSettings[K]): void {
  const s = readUser();
  s[key] = value;
  writeUser(s);
}

/** Set the OWNER LOCK — the baseline that survives even "reset to defaults". */
export function setOwnerSetting<K extends keyof ZolaSettings>(key: K, value: ZolaSettings[K]): void {
  const s = readOwner();
  s[key] = value;
  writeOwner(s);
}

/** Clear the user settings (falls back to the owner lock → defaults). */
export function resetToOwnerDefaults(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch { /* noop */ }
}

/** The owner has set the main character/mode — call once, persists forever. */
export function lockOwnerDefaults(settings: Partial<ZolaSettings>): void {
  writeOwner(settings);
}

/** Is there an owner lock? */
export function hasOwnerLock(): boolean {
  return Object.keys(readOwner()).length > 0;
}
