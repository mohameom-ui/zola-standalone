// ============================================================================
// DRONE PET — Sound I/O
//  • SoundWatch: listens to the ambient soundscape via Web Audio. NEVER
//    records or transmits audio — it only computes a live loudness number and
//    two reflex events (clap = attention, sustained noise = startled).
//    (Speech understanding lives in ears.ts; both can share the mic.)
//  • PetChirps: the drone's non-verbal voice — tiny synthesized chirps for
//    moods and events, so it communicates even when speech is off.
// ============================================================================

type ChirpKind = "happy" | "excited" | "alert" | "sleepy" | "curious" | "sad";

export class SoundWatch {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(new ArrayBuffer(2048 * 4));
  private freq = new Uint8Array(1024);
  private lastClassify = 0;
  private raf = 0;
  private prevLevel = 0;
  private lastClap = 0;
  private lastNoise = 0;
  private running = false;

  onClap: () => void = () => {};
  onNoise: () => void = () => {};
  /** classified sound: what the sound IS, not just that it is loud */
  onSoundEvent: (kind: "thud" | "voice" | "music") => void = () => {};
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
    } catch {
      return false;
    }
    this.running = true;
    const loop = () => {
      if (!this.running || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const level = Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
      const now = performance.now();

      // clap: sharp impulse spike
      if (level > 0.3 && level - this.prevLevel > 0.22 && now - this.lastClap > 1200) {
        this.lastClap = now;
        this.onClap();
      }
      // sustained loud noise
      if (level > 0.4 && now - this.lastNoise > 8000) {
        this.lastNoise = now;
        this.onNoise();
      }
      this.onLevel(level);

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
          if (level > 0.22 && low > mid * 1.6) this.onSoundEvent("thud");
          else if (mid > 0.06 && mid > high * 1.4) this.onSoundEvent("voice");
          else if (mid + high > 0.1 && level > 0.08) this.onSoundEvent("music");
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
    else if (mood === "sleepy" || mood === "sleeping") this.chirp("sleepy");
    else if (mood === "curious") this.chirp("curious");
  }
}
