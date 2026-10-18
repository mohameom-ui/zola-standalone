// ============================================================================
// DRONE PET — Ears (microphone / speech recognition)
// Web Speech API wrapper with auto-restart. On the real drone this maps to a
// USB mic + whisper.cpp / Vosk running on the Pi.
// ============================================================================

interface SRResultEvent {
  results: { isFinal: boolean; 0: { transcript: string } }[];
  resultIndex: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

type SRCtor = new () => SpeechRecognitionLike;

export class DroneEars {
  private rec: SpeechRecognitionLike | null = null;
  private enabled = false;
  private startedAt = 0;

  /** surfaced to the UI log: engine state, network problems, empty results */
  onDiagnostics: (msg: string) => void = () => {};

  get listening() { return this.enabled; }

  start(onTranscript: (text: string) => void, onState?: (listening: boolean) => void, onError?: (msg: string) => void): boolean {
    const Ctor = (window as unknown as { webkitSpeechRecognition?: SRCtor; SpeechRecognition?: SRCtor })
      .webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: SRCtor }).SpeechRecognition;
    if (!Ctor) {
      onError?.("SPEECH RECOGNITION UNSUPPORTED — use Chrome or Edge");
      return false;
    }
    this.enabled = true;
    this.startedAt = Date.now();
    const rec = new Ctor();
    this.onDiagnostics?.("SPEECH ENGINE ONLINE — say a command like: come here");
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const heard = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal && heard) {
          onTranscript(heard);
        } else if (!e.results[i].isFinal && heard) {
          this.onDiagnostics?.(`hearing: “${heard}”…`);
        }
      }
    };
    rec.onend = () => {
      if (this.enabled) {
        try { rec.start(); } catch { /* restart race is harmless */ }
      } else {
        this.onDiagnostics?.("SPEECH ENGINE STOPPED");
        onState?.(false);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.enabled = false;
        onError?.("MIC DENIED — check browser permissions (address-bar 🎤 icon)");
        onState?.(false);
      } else if (e.error === "network") {
        this.onDiagnostics?.("SPEECH NETWORK ERROR — Chrome's speech engine needs internet access");
      } else if (e.error === "no-speech") {
        const silentFor = Math.round((Date.now() - this.startedAt) / 1000);
        if (silentFor > 20) this.onDiagnostics?.("hearing silence — speak louder / closer to the mic");
      } else if (e.error === "aborted") {
        /* restart race — harmless */
      } else {
        this.onDiagnostics?.(`speech engine event: ${e.error}`);
      }
    };
    this.rec = rec;
    try { rec.start(); } catch { /* already started */ }
    onState?.(true);
    return true;
  }

  stop() {
    this.enabled = false;
    try { this.rec?.stop(); } catch { /* noop */ }
    this.rec = null;
  }
}
