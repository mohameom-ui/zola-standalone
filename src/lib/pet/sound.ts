// ============================================================================
// DRONE PET — Sound I/O
//  • SoundWatch: listens to the ambient soundscape via Web Audio. NEVER
//    records or transmits audio — it only computes a live loudness number and
//    two reflex events (clap = attention, sustained noise = startled).
//    (Speech understanding lives in ears.ts; both can share the mic.)
//  • PetChirps: the drone's non-verbal voice — tiny synthesized chirps for
//    moods and events, so it communicates even when speech is off.
// ============================================================================

import { circadianVoice, circadianEnvelope } from "./suncalc";

type ChirpKind = "happy" | "excited" | "alert" | "sleepy" | "curious" | "sad";

export class SoundWatch {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(new ArrayBuffer(2048 * 4));
  private freq = new Uint8Array(1024);
  private bufL = new Float32Array(new ArrayBuffer(2048 * 4));
  private bufR = new Float32Array(new ArrayBuffer(2048 * 4));
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  lastDirection = 0;
  private lastSpatialDir = 0;
  private lastDir = 0;
  private lastClassify = 0;
  private raf = 0;
  private prevLevel = 0;
  private lastClap = 0;
  private lastNoise = 0;
  private noiseFloor = 0.05;
  private noiseFrames = 0;
  private running = false;

  onClap: () => void = () => {};
  onNoise: () => void = () => {};
  /** classified sound: what the sound IS, not just that it is loud */
  onSoundEvent: (kind: "thud" | "voice" | "music") => void = () => {};
  /** spatial: which direction a sound is coming from (stereo L/R comparison) */
  onSoundDirection: (dir: "left" | "right" | "center", level: number) => void = () => {};
  /** live RMS level 0..~1, for the HUD meter */
  onLevel: (level: number) => void = () => {};

  get active() { return this.running; }

  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser); // analysis only — never routed to output
      // stereo split for spatial sound localization
      try {
        const splitter = this.ctx.createChannelSplitter(2);
        src.connect(splitter);
        this.analyserL = this.ctx.createAnalyser();
        this.analyserR = this.ctx.createAnalyser();
        this.analyserL.fftSize = 2048;
        this.analyserR.fftSize = 2048;
        splitter.connect(this.analyserL, 0);
        splitter.connect(this.analyserR, 1);
      } catch { /* mono mic — no spatial localization */ }
    } catch {
      return false;
    }
    this.running = true;
    const loop = () => {
      if (!this.running || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const level = Math.min(1, Math.sqrt(sum / this.buf.length) * 2.5);
      const now = performance.now();

      // adaptive noise floor: learn the room's ambient level, ignore it
      this.noiseFloor = this.noiseFloor * 0.995 + level * 0.005;
      const noiseThreshold = Math.max(0.55, this.noiseFloor * 4.0);

      // clap: sharp impulse spike — must be SIGNIFICANTLY above ambient
      if (level > noiseThreshold * 1.5 && level - this.prevLevel > 0.25 && now - this.lastClap > 5000) {
        this.lastClap = now;
        this.onClap();
      }
      // sustained loud noise: requires 10 consecutive frames above a HIGH bar
      if (level > noiseThreshold * 2.0) {
        this.noiseFrames = (this.noiseFrames ?? 0) + 1;
        if (this.noiseFrames >= 10 && now - this.lastNoise > 180_000) {
          this.lastNoise = now;
          this.noiseFrames = 0;
          this.onNoise();
        }
      } else {
        this.noiseFrames = 0;
      }
      this.onLevel(level);

      // spatial sound localization: L/R energy comparison → azimuth estimate
      if (this.analyserL && this.analyserR && now - this.lastDir > 600) {
        this.lastDir = now;
        this.analyserL.getFloatTimeDomainData(this.bufL);
        this.analyserR.getFloatTimeDomainData(this.bufR);
        let sl = 0, sr = 0;
        for (let i = 0; i < this.bufL.length; i++) { sl += this.bufL[i] ** 2; sr += this.bufR[i] ** 2; }
        sl = Math.sqrt(sl / this.bufL.length); sr = Math.sqrt(sr / this.bufR.length);
        const total = sl + sr;
        if (total > 0.06) {
          const pan = (sl - sr) / (total || 1); // -1 = full left, +1 = full right
          if (Math.abs(pan) < 0.15) this.onSoundDirection("center", level);
          else if (pan > 0) this.onSoundDirection("left", level);
          else this.onSoundDirection("right", level);
        }
      }

      // --- sound classification (spectral heuristics, every ~0.8 s) -------------
      if (this.analyser) {
        this.analyser.getByteFrequencyData(this.freq);
        if (now - this.lastClassify > 800) {
          this.lastClassify = now;
          const nyq = this.ctx ? this.ctx.sampleRate / 2 : 24000;
          const band = (hz0: number, hz1: number) => {
            const b0 = Math.floor((hz0 / nyq) * this.freq.length);
            const b1 = Math.min(this.freq.length, Math.ceil((hz1 / nyq) * this.freq.length));
            let s = 0;
            for (let i = b0; i < b1; i++) s += this.freq[i];
            return s / Math.max(1, b1 - b0) / 255;
          };
          const low = band(30, 150);
          const mid = band(250, 1200);
          const high = band(1500, 5000);
          if (level > 0.55 && low > mid * 1.6) this.onSoundEvent("thud");
          else if (mid > 0.2 && mid > high * 1.4) this.onSoundEvent("voice");
          else if (mid + high > 0.3 && level > 0.25) this.onSoundEvent("music");
        }
      }

      this.prevLevel = this.prevLevel * 0.7 + level * 0.3;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return true;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}

export class PetChirps {
  private ctx: AudioContext | null = null;
  enabled = true;
  /** LIBRARY UPGRADE: real Kenney SFX (GameDevLibrary) with synth fallback */
  private sfx: Partial<Record<string, string>> = {
    happy: "/sfx/zola/chirp-happy.ogg",
    excited: "/sfx/zola/chirp-excited.ogg",
    curious: "/sfx/zola/chirp-curious.ogg",
    alert: "/sfx/zola/alert.ogg",
  };
  private engineEl: HTMLAudioElement | null = null;

  private ac(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Short pet vocalization — library SFX if available, synth fallback. */
  chirp(kind: ChirpKind) {
    const file = this.sfx[kind];
    if (file) {
      try {
        const a = new Audio(file);
        a.volume = 0.45;
        void a.play().catch(() => this.chirpSynth(kind));
        return;
      } catch {
        this.chirpSynth(kind);
        return;
      }
    }
    this.chirpSynth(kind);
  }

  /** One-shot library SFX (gusts, thuds, events). */
  playFile(name: "gust" | "thud" | "engine", volume = 0.35) {
    try {
      const a = new Audio(`/sfx/zola/${name}.ogg`);
      a.volume = volume;
      void a.play().catch(() => {});
    } catch { /* noop */ }
  }

  /** Hover engine ambience — on while airborne, off on the ground. */
  setEngine(on: boolean) {
    try {
      if (on) {
        if (!this.engineEl) {
          this.engineEl = new Audio("/sfx/zola/engine.ogg");
          this.engineEl.loop = true;
          this.engineEl.volume = 0.12;
        }
        void this.engineEl.play().catch(() => {});
      } else if (this.engineEl) {
        this.engineEl.pause();
      }
    } catch { /* noop */ }
  }

  /** Original synthesized vocalization — offline fallback. */
  private chirpSynth(kind: ChirpKind) {
    const ctx = this.ac();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.06; // soft — chirps are seasoning, not sirens
    master.connect(ctx.destination);

    const blip = (start: number, f0: number, f1: number, dur: number, type: OscillatorType) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0 + start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + start + dur);
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(1, t0 + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      osc.connect(g).connect(master);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    };

    switch (kind) {
      case "happy": // two rising blips
        blip(0, 700, 1100, 0.09, "sine");
        blip(0.12, 900, 1400, 0.1, "sine");
        break;
      case "excited": // soft trill
        for (let i = 0; i < 4; i++) blip(i * 0.07, 800 + i * 100, 1300, 0.05, "sine");
        break;
      case "alert": // double beep
        blip(0, 520, 520, 0.09, "square");
        blip(0.16, 520, 520, 0.09, "square");
        break;
      case "sleepy": // descending sigh
        blip(0, 320, 170, 0.5, "sine");
        break;
      case "curious": // question chirp
        blip(0, 550, 950, 0.14, "sine");
        break;
      case "sad":
        blip(0, 500, 260, 0.35, "triangle");
        break;
    }
  }

  chirpForMood(mood: string) {
    if (mood === "happy" || mood === "excited") this.chirp(mood === "excited" ? "excited" : "happy");
    else if (mood === "alarmed") this.chirp("alert");
    else if (mood === "sleepy" || mood === "sleeping") this.express("sleepy");
    else if (mood === "curious") this.chirp("curious");
    else this.express(mood); // idle + anything new — a procedural motif
  }

  /** WAVE 2 — MICRO-CHIRP EXPANSION: randomized procedural motifs, so her
   * non-verbal voice never repeats exactly. Each emotion has a motif family;
   * pitch/tempo/count vary per call. Quiet by design (companion rule). */
  express(emotion: string) {
    const ctx = this.ac();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // WAVE 6 — circadian pitch: her chirps sit higher in the morning, softer
    // and lower toward evening/night (human-rhythm friendly)
    const cp = circadianVoice().pitch;
    // WAVE 6.6 — circadian envelopes: crisp mornings, velvet nights
    const env = circadianEnvelope();
    const master = ctx.createGain();
    master.gain.value = 0.055;
    master.connect(ctx.destination);
    const v = (pct: number) => 1 + (Math.random() * 2 - 1) * pct; // ±pct variation
    const blip = (start: number, f0: number, f1: number, dur: number, type: OscillatorType, vol = 1) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0 * cp, t0 + start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1 * cp), t0 + start + dur);
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(vol, t0 + start + Math.max(0.006, 0.015 * env.attack));
      g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur * env.release);
      osc.connect(g).connect(master);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur * env.release + 0.05);
    };
    switch (emotion) {
      case "happy": {
        const base = 640 * v(0.15);
        const n = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) blip(i * 0.11, base, base * 1.5 * v(0.1), 0.09, "sine");
        break;
      }
      case "excited": {
        const n = 4 + Math.floor(Math.random() * 3);
        const base = 800 * v(0.15);
        for (let i = 0; i < n; i++) blip(i * 0.06 * v(0.2), base + i * 90, base + i * 110 + 250, 0.05, "sine", 0.9);
        break;
      }
      case "curious": {
        // a question mark in sound: rise… then a small fall
        const base = 520 * v(0.12);
        blip(0, base, base * 1.7, 0.16, "triangle");
        if (Math.random() < 0.6) blip(0.22, base * 1.4, base * 0.9, 0.12, "triangle", 0.7);
        break;
      }
      case "sleepy": {
        // one long soft downward slide — a yawn with a melody
        blip(0, 420 * v(0.1), 200 * v(0.1), 0.6 + Math.random() * 0.4, "sine", 0.8);
        break;
      }
      case "sad": {
        const base = 480 * v(0.1);
        blip(0, base, base * 0.6, 0.22, "sine");
        blip(0.28, base * 0.9, base * 0.5, 0.26, "sine", 0.85);
        break;
      }
      case "alarmed": {
        blip(0, 950 * v(0.1), 950 * v(0.1), 0.07, "square", 0.7);
        blip(0.14, 950 * v(0.1), 950 * v(0.1), 0.07, "square", 0.7);
        break;
      }
      default: {
        // idle / unknown: a single gentle mid blip, sometimes two
        const base = 600 * v(0.18);
        blip(0, base, base * 1.25, 0.1, "sine", 0.75);
        if (Math.random() < 0.35) blip(0.18, base * 1.1, base * 1.35, 0.08, "sine", 0.6);
      }
    }
  }
}
