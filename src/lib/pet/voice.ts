// ============================================================================
// DRONE PET — Voice v2 (the "she sounds alive" upgrade)
// • Voice ranking: neural "Natural" voices (Edge) > Google voices > macOS
//   quality voices > anything — she picks the best voice on the machine.
// • Sentence-chunked speech: utterances queue per sentence with natural
//   micro-pauses — this is where "flow" comes from.
// • Per-persona delivery: SWEET warm and light, GRUMPY slow and low,
//   HYPER quick and bright, ROAST clipped and pointed.
// ============================================================================

export interface VoiceStyle {
  pitch: number;
  rate: number;
}

const PERSONA_STYLES: Record<string, VoiceStyle> = {
  SWEET: { pitch: 1.1, rate: 1.02 },
  EXPLORER: { pitch: 1.12, rate: 1.0 },
  HYPER: { pitch: 1.18, rate: 1.08 },
  SKITTISH: { pitch: 1.2, rate: 1.06 },
  GRUMPY: { pitch: 0.96, rate: 0.94 },
  DREAMING: { pitch: 0.95, rate: 0.9 },
  "ROAST MODE": { pitch: 1.06, rate: 1.07 },
  SULKING: { pitch: 0.95, rate: 0.92 },
};

function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  if (!v.lang.toLowerCase().startsWith("en")) return 0;
  // the robotic Windows desktop voices are the reason pets sound like GPS units
  if (/david|mark|george|reed|richard|guy/i.test(n)) return 5;
  if (/natural/.test(n)) return 100 + (/aria|jenny|emma|ava|michelle|female/.test(n) ? 10 : 0);
  if (/online/.test(n)) return 90;
  if (/google/.test(n)) return 80 + (/uk english female|us english/i.test(n) ? 8 : 0);
  if (/samantha|victoria|karen|moira|tessa|fiona/.test(n)) return 60; // macOS neural-ish
  if (/zira|eva|susan|hazel/.test(n)) return 50;
  if (v.localService) return 20;
  return 40;
}

export class DroneVoice {
  private enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private style: VoiceStyle = { pitch: 1.12, rate: 1.03 };

  constructor() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      this.pickVoice();
      window.speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  /** Best available voice on this machine — prefers neural "Natural" voices. */
  private pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    // user's chosen voice wins (persisted)
    try {
      const saved = localStorage.getItem("aura.voice");
      if (saved) {
        const v = voices.find((x) => x.name === saved);
        if (v) { this.voice = v; return; }
      }
    } catch { /* noop */ }
    const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    this.voice = ranked[0];
  }

  getVoiceName(): string {
    return this.voice?.name ?? "system default";
  }

  /** English voices available on this machine, for the picker UI. */
  listVoices(): { name: string; lang: string }[] {
    if (typeof window === "undefined" || !window.speechSynthesis) return [];
    return window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith("en"))
      .map((v) => ({ name: v.name, lang: v.lang }));
  }

  /** Persistent voice choice (survives reloads). */
  setVoiceByName(name: string) {
    const v = window.speechSynthesis?.getVoices().find((x) => x.name === name);
    if (v) {
      this.voice = v;
      try { localStorage.setItem("aura.voice", name); } catch { /* noop */ }
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) window.speechSynthesis?.cancel();
  }

  get isEnabled() { return this.enabled; }

  setPersonaStyle(persona: string) {
    this.style = PERSONA_STYLES[persona] ?? { pitch: 1.12, rate: 1.03 };
  }

  /** true while her voice is actually coming out of the speakers */
  isSpeaking(): boolean {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    return window.speechSynthesis.speaking || window.speechSynthesis.pending;
  }

  /**
   * Speak with natural flow. interrupt=true (commands) cuts in;
   * interrupt=false (ambient chatter) never cuts her off — it waits or skips.
   */
  speak(text: string, opts?: { interrupt?: boolean }) {
    if (!this.enabled || !text || typeof window === "undefined" || !window.speechSynthesis) return;
    const interrupt = opts?.interrupt ?? true;
    const synth = window.speechSynthesis;
    if (!interrupt && (synth.speaking || synth.pending)) return; // don't talk over herself
    if (interrupt) synth.cancel();
    // sentence chunks; long sentences split at commas → breath-like cadence.
    // prosody stays CONSTANT within one reply — chunk-to-chunk pitch jumping
    // is exactly what made her sound warbly/weird.
    const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
    const parts: string[] = [];
    for (const s of sentences) {
      const words = s.trim().split(/\s+/).length;
      if (words > 12) {
        const commas = s.split(/,\s*/).filter(Boolean);
        parts.push(...commas.map((c, i) => (i < commas.length - 1 && !/[,\s]$/.test(c) ? c + "," : c)));
      } else {
        parts.push(s);
      }
    }
    for (const part of parts) {
      const u = new SpeechSynthesisUtterance(part.trim());
      if (this.voice) u.voice = this.voice;
      u.pitch = this.style.pitch;
      u.rate = this.style.rate;
      u.volume = 0.95;
      synth.speak(u);
    }
  }
}
