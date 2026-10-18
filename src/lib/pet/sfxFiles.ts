// ============================================================================
// DRONE PET — File-based SFX (from the GameDevLibrary, CC0)
// Real samples for her mood/state feedback, replacing synth blips where a
// sample exists. Every file ships inside the app (public/sfx/zola/) — offline.
// ============================================================================

const BASE = "/sfx/zola";

const MOOD_SOUNDS: Record<string, string[]> = {
  happy: [`${BASE}/moods/spaceEngine_001.ogg`, `${BASE}/moods/spaceEngine_003.ogg`],
  excited: [`${BASE}/moods/spaceEngine_000.ogg`, `${BASE}/moods/computerNoise_001.ogg`],
  curious: [`${BASE}/moods/computerNoise_000.ogg`, `${BASE}/moods/spaceEngine_002.ogg`],
  alarmed: [`${BASE}/moods/spaceEngineLarge_000.ogg`],
  sleepy: [`${BASE}/moods/computerNoise_002.ogg`],
  sleeping: [`${BASE}/moods/computerNoise_003.ogg`],
};

const UI_SOUNDS = {
  click: `${BASE}/ui/click_001.ogg`,
  confirm: `${BASE}/ui/confirmation_001.ogg` in {} ? "" : `${BASE}/ui/confirmation_001.ogg`,
};

export class SfxFiles {
  private ac: AudioContext | null = null;
  private cache = new Map<string, AudioBuffer>();
  private muted = false;
  private lastPlayed: Record<string, number> = {};

  setMuted(on: boolean) { this.muted = on; }

  private acx(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ac) this.ac = new AudioContext();
      if (this.ac.state === "suspended") void this.ac.resume();
      return this.ac;
    } catch { return null; }
  }

  /** Fire-and-forget sample with cooldown per key (companion volume, not arcade). */
  play(path: string, key = path, cooldownMs = 4000, volume = 0.25) {
    const ac = this.acx();
    if (!ac) return;
    const now = performance.now();
    if (now - (this.lastPlayed[key] ?? 0) < cooldownMs) return;
    this.lastPlayed[key] = now;
    void (async () => {
      try {
        let buf = this.cache.get(path);
        if (!buf) {
          const r = await fetch(path);
          if (!r.ok) return;
          buf = await ac.decodeAudioData(await r.arrayBuffer());
          this.cache.set(path, buf);
        }
        const src = ac.createBufferSource();
        const g = ac.createGain();
        src.buffer = buf;
        g.gain.value = volume;
        src.connect(g).connect(ac.destination);
        src.start();
      } catch { /* sample failures are silently ignorable */ }
    })();
  }

  playMood(mood: string) {
    const pool = MOOD_SOUNDS[mood];
    if (!pool || pool.length === 0) return;
    this.play(pool[Math.floor(Math.random() * pool.length)], `mood-${mood}`, 6000, 0.2);
  }

  playUiClick() { this.play(UI_SOUNDS.click, "ui-click", 300, 0.3); }
}
