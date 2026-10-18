// ============================================================================
// DRONE PET — Piper Voice Pack (her authentic Pi voice, pre-rendered)
// The line pack is generated from her brain's exact line tables with Piper
// (en_US-amy-medium) — the same voice that runs on her drone body. When a
// spoken line matches the pack, she plays the pre-rendered WAV (her real
// Pi voice in the browser); dynamic lines fall back to the neural engine.
// ============================================================================

interface PiperManifest {
  [slug: string]: string;
}

const PACK_BASE = "/voices/piper";

export class PiperPack {
  private manifest: PiperManifest | null = null;
  private reverse: Map<string, string> | null = null;
  private loading: Promise<boolean> | null = null;
  private ac: AudioContext | null = null;
  private activeSrc: AudioBufferSourceNode | null = null;
  private speakingFlag = false;
  enabled = true;

  async ensureLoaded(): Promise<boolean> {
    if (this.manifest) return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const r = await fetch(`${PACK_BASE}/manifest.json`, { cache: "force-cache" });
        if (!r.ok) return false;
        this.manifest = (await r.json()) as PiperManifest;
        this.reverse = new Map(Object.entries(this.manifest).map(([slug, text]) => [text, slug]));
        return true;
      } catch {
        return false;
      }
    })();
    return this.loading;
  }

  /** Exact-match lookup: does she have a pre-rendered line for this text? */
  has(text: string): boolean {
    return !!this.reverse?.has(text);
  }

  isSpeaking(): boolean { return this.speakingFlag; }

  cancel() {
    try { this.activeSrc?.stop(); } catch { /* noop */ }
    this.activeSrc = null;
    this.speakingFlag = false;
  }

  /** Play the pre-rendered line. Returns false if no match (caller falls back). */
  async speak(text: string): Promise<boolean> {
    if (!this.enabled || !this.manifest) return false;
    const slug = this.reverse?.get(text);
    if (!slug) return false;
    try {
      const r = await fetch(`${PACK_BASE}/${slug}.wav`, { cache: "force-cache" });
      if (!r.ok) return false;
      const buf = await r.arrayBuffer();
      const ac = this.ac ?? (this.ac = new AudioContext());
      if (ac.state === "suspended") await ac.resume();
      const audioBuf = await ac.decodeAudioData(buf);
      this.cancel();
      const src = ac.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ac.destination);
      src.onended = () => {
        if (this.activeSrc === src) { this.activeSrc = null; this.speakingFlag = false; }
      };
      this.activeSrc = src;
      this.speakingFlag = true;
      src.start();
      return true;
    } catch {
      return false;
    }
  }
}
