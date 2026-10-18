// ============================================================================
// DRONE PET — Neural Voice (Kokoro-82M, from the internet)
// A real neural TTS model running in her browser runtime — dramatically more
// natural than OS/browser voices. Downloaded once (~90 MB), then fully
// offline. Same privacy contract: text in, audio out, nothing leaves.
// ============================================================================

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart — warm female (best)" },
  { id: "af_bella", label: "Bella — bright female" },
  { id: "af_nicole", label: "Nicole — soft female" },
  { id: "am_michael", label: "Michael — calm male" },
  { id: "am_adam", label: "Adam — deep male" },
  { id: "bf_emma", label: "Emma — British female" },
] as const;

interface KokoroLike {
  generate: (text: string, opts: Record<string, unknown>) => Promise<{ audio: Float32Array; sampling_rate: number }>;
}

export class NeuralVoice {
  private tts: KokoroLike | null = null;
  private ac: AudioContext | null = null;
  private activeSrc: AudioBufferSourceNode | null = null;
  private speakingFlag = false;
  voice = "af_heart";
  rate = 1.0;
  enabled = true;
  loaded = false;

  async load(onDiag: (m: string) => void): Promise<boolean> {
    if (this.loaded) return true;
    onDiag("NEURAL VOICE: fetching her real voice from the internet once (~90 MB)...");
    try {
      // runtime CDN import of the SELF-CONTAINED browser build — this keeps the
      // Node-only bindings out of the app bundle (which crashes the dev server)
      const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
      const k = (await dynamicImport("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js")) as unknown as {
        KokoroTTS: {
          from_pretrained: (id: string, opts: Record<string, unknown>) => Promise<KokoroLike>;
        };
      };
      this.tts = await k.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p?.status === "progress" && typeof p.progress === "number") {
            onDiag(`NEURAL VOICE: download ${Math.round(p.progress)}%`);
          }
        },
      });
      this.ac = this.ac ?? new AudioContext();
      this.loaded = true;
      onDiag(`NEURAL VOICE: online — she now speaks with a real neural voice (${this.voice})`);
      return true;
    } catch (e) {
      onDiag(`NEURAL VOICE failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  setVoice(id: string) { this.voice = id; }
  /** delivery speed 0.8-1.15, mapped from her persona */
  setRate(r: number) { this.rate = Math.max(0.8, Math.min(1.15, r)); }

  isSpeaking(): boolean { return this.speakingFlag; }

  cancel() {
    try { this.activeSrc?.stop(); } catch { /* noop */ }
    this.activeSrc = null;
    this.speakingFlag = false;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  /** Returns false if the neural voice isn't available (caller falls back to browser TTS). */
  async speak(text: string, opts?: { interrupt?: boolean }): Promise<boolean> {
    if (!this.enabled || !this.loaded || !this.tts) return false;
    const interrupt = opts?.interrupt ?? true;
    if (!interrupt && this.speakingFlag) return true; // chatter never talks over her
    if (interrupt) this.cancel();

    const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
    for (const s of sentences) {
      if (!this.enabled) break;
      try {
        const out = await this.tts.generate(s.trim(), { voice: this.voice, speed: this.rate });
        await this.play(out.audio, out.sampling_rate);
      } catch {
        return false; // let the caller fall back to browser TTS
      }
    }
    return true;
  }

  private play(f32: Float32Array, sr: number): Promise<void> {
    return new Promise((resolve) => {
      const ac = this.ac ?? (this.ac = new AudioContext());
      const buf = ac.createBuffer(1, f32.length, sr);
      buf.getChannelData(0).set(f32);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.onended = () => {
        if (this.activeSrc === src) { this.activeSrc = null; this.speakingFlag = false; }
        resolve();
      };
      this.activeSrc = src;
      this.speakingFlag = true;
      src.start();
    });
  }
}
