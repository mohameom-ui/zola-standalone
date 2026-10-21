// SETTINGS.TS — test suite: persistence, owner lock, the tier system

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSettings, setUserSetting, setOwnerSetting,
  resetToOwnerDefaults, hasOwnerLock, lockOwnerDefaults,
} from "./settings";

const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageStub, configurable: true,
});

describe("the settings system", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("returns defaults when nothing is set", () => {
    const s = loadSettings();
    expect(s.modeName).toBe("Happy Loopy");
    expect(s.mood).toBe("curious");
    expect(s.autoRotate).toBe(false);
  });

  it("user settings persist across loads", () => {
    setUserSetting("modeName", "Zola Bogey");
    setUserSetting("mood", "happy");
    const s = loadSettings();
    expect(s.modeName).toBe("Zola Bogey");
    expect(s.mood).toBe("happy");
  });

  it("the owner lock is the default — the user's explicit choice wins", () => {
    setOwnerSetting("modeName", "Zola Bogey");
    setUserSetting("modeName", "Zola NY Girl");
    const s = loadSettings();
    expect(s.modeName).toBe("Zola NY Girl"); // the user chose this — it persists
  });

  it("without user settings, the owner lock fills in", () => {
    setOwnerSetting("modeName", "Zola Bogey");
    // no user setting for modeName
    const s = loadSettings();
    expect(s.modeName).toBe("Zola Bogey"); // the owner lock fills the gap
  });

  it("user settings override the owner lock for their session", () => {
    setOwnerSetting("mood", "happy");
    setUserSetting("mood", "excited");
    const s = loadSettings();
    expect(s.mood).toBe("excited");
  });

  it("reset to owner defaults clears user settings but keeps the lock", () => {
    setOwnerSetting("modeName", "Zola Bogey");
    setUserSetting("modeName", "Zola NY Girl");
    setUserSetting("accentColor", "#ff0000");
    resetToOwnerDefaults();
    const s = loadSettings();
    expect(s.modeName).toBe("Zola Bogey"); // the owner lock persists
    expect(s.accentColor).toBe("#35d0a5"); // back to the default
    expect(hasOwnerLock()).toBe(true);
  });

  it("no owner lock = reset goes to factory defaults", () => {
    setUserSetting("modeName", "Zola NY Girl");
    resetToOwnerDefaults();
    const s = loadSettings();
    expect(s.modeName).toBe("Happy Loopy"); // the factory default
  });

  it("the owner lock survives everything", () => {
    lockOwnerDefaults({ modeName: "Zola Bogey", mood: "happy" });
    setUserSetting("modeName", "Zola NY Girl");
    resetToOwnerDefaults();
    expect(loadSettings().modeName).toBe("Zola Bogey");
  });
});
