// ============================================================================
// DRONE PET — Procedural Ambient Music (Web Audio, 100% local, no samples)
// A generative, non-repeating soundscape that follows her mood:
//   happy/excited → brighter pentatonic blooms, gentle motion
//   curious/idle  → warm mid-register, sparse
//   sleepy/sleeping → dark, very sparse, long swells
//   alarmed       → low pulse (attention without panic)
// Companion rule: always QUIET — this is room tone with a soul, not a concert.
// Hardware-agnostic: pure Web Audio, runs in her browser runtime unchanged.
// ============================================================================

const SCALES: Record<string, number[]> = {
  // semitone offsets from the root (pentatonic families — always consonant)
  bright: [0, 2, 4, 7, 9, 12, 14],
  warm: [0, 3, 5, 7, 10, 12, 15],
  dark: [0, 3, 7, 10, 12],
};

const MOOD_PROFILE: Record<string, { root: number; scale: keyof typeof SCALES; interval: [number, number]; gain: number; filter: number }> = {
  happy: { root: 220, scale: "bright", interval: [1800, 3600], gain: 0.05, filter: 2400 },
  excited: { root: 262, scale: "bright", interval: [900, 2200], gain: 0.06, filter: 3200 },
  curious: { root: 196, scale: "warm", interval: [2400, 4800], gain: 0.04, filter: 1800 },
  idle: { root: 174, scale: "warm", interval: [3200, 6400], gain: 0.035, filter: 1500 },
  sleepy: { root: 147, scale: "dark", interval: [5000, 9000], gain: 0.03, filter: 900 },
  sleeping: { root: 131, scale: "dark", interval: [7000, 13000], gain: 0.02, filter: 700 },
  alarmed: { root: 110, scale: "dark", interval: [1400, 1400], gain: 0.05, filter: 1200 },
};

export class AmbientMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private padOscs: OscillatorNode[] = [];
  private mood = "idle";
  private nextAt = 0;
  enabled = false;

  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      // gentle space: two delays feeding back, no convolution IR needed
      const delay = this.ctx.createDelay(1.2);
      delay.delayTime.value = 0.42;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.35;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
      this.master.connect(delay);
      delay.connect(fb); fb.connect(delay);
      delay.connect(wet); wet.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private pad(profile: typeof MOOD_PROFILE[string]) {
    const ctx = this.ctx!;
    // breath slowly between two detuned sines at the root — her "room tone"
    for (const detune of [-4, 3]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = profile.root / 2;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.04;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.12;
      lfo.connect(lfoGain); lfoGain.connect(g.gain);
      osc.connect(g); g.connect(this.master!);
      osc.start(); lfo.start();
      this.padOscs.push(osc, lfo);
    }
  }

  private bloom() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const profile = MOOD_PROFILE[this.mood] ?? MOOD_PROFILE.idle;
    const scale = SCALES[profile.scale];
    const t = ctx.currentTime;
    const note = profile.root * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12) * (Math.random() < 0.3 ? 2 : 1);
    const osc = ctx.createOscillator();
    osc.type = this.mood === "sleepy" || this.mood === "sleeping" ? "sine" : "triangle";
    osc.frequency.value = note;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = profile.filter;
    const dur = this.mood === "sleeping" ? 9 : 5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(profile.gain, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(lp); lp.connect(this.master!);
    osc.start(t); osc.stop(t + dur + 0.1);
    // schedule the next bloom — never a grid, never repeating
    const [lo, hi] = profile.interval;
    this.nextAt = t + (lo + Math.random() * (hi - lo)) / 1000;
    this.timer = setTimeout(() => this.bloom(), (this.nextAt - ctx.currentTime) * 1000);
  }

  start(mood: string): boolean {
    const ctx = this.ensureCtx();
    if (!ctx) return false;
    void ctx.resume();
    this.mood = mood;
    this.enabled = true;
    if (this.padOscs.length === 0) this.pad(MOOD_PROFILE[this.mood] ?? MOOD_PROFILE.idle);
    if (this.master) this.master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    if (!this.timer) this.bloom();
    return true;
  }

  setMood(mood: string) {
    if (this.mood === mood) return;
    this.mood = mood;
    // re-tune the pad softly toward the new mood's root
    const ctx = this.ctx;
    if (!ctx) return;
    const root = (MOOD_PROFILE[mood] ?? MOOD_PROFILE.idle).root / 2;
    this.padOscs.forEach((o, i) => {
      if (o.type === "sine") {
        o.frequency.linearRampToValueAtTime(root, ctx.currentTime + 4);
        o.detune.linearRampToValueAtTime(i % 2 === 0 ? -4 : 3, ctx.currentTime + 4);
      }
    });
  }

  stop() {
    const ctx = this.ctx;
    this.enabled = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (ctx && this.master) this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  }

  dispose() {
    this.stop();
    for (const o of this.padOscs) { try { o.stop(); } catch { /* already stopped */ } }
    this.padOscs = [];
    void this.ctx?.close();
    this.ctx = null;
  }
}
