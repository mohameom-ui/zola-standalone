// ============================================================================
// DRONE PET — Local Ears v2 (on-device speech recognition)
// Whisper running fully in-browser. Improvements over v1:
//   • WebGPU decoding when available (much faster), WASM fallback
//   • model quality switch: tiny.en (fast) <-> base.en (deeper understanding)
//   • SELF-HEARING SUPPRESSION: muted while she herself is speaking, so her
//     own voice through the speakers never pollutes what she "hears"
//   • no dropped speech: utterances arriving while decoding are queued
//   • adaptive noise-floor VAD with cleaner utterance boundaries
// ============================================================================

type AsrPipeline = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text?: string }>;

const LOCAL_BASE = "/models/whisper-tiny-en";
const HF_ID = "onnx-community/whisper-tiny.en";
const SR = 16000;
const BLOCK = 4096;              // ~0.256 s
const SILENCE_TAIL_BLOCKS = 4;   // ~1.0 s of silence closes an utterance
const MIN_UTTERANCE = SR * 0.3;
const MAX_UTTERANCE = SR * 14;

export const EAR_MODELS = { fast: "onnx-community/whisper-tiny.en", deep: "onnx-community/whisper-base.en" } as const;
export type EarQuality = keyof typeof EAR_MODELS;

export class LocalEars {
  private ac: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private asr: AsrPipeline | null = null;
  private asrModel: string = EAR_MODELS.fast;
  private running = false;
  private busy = false;
  private speaking = false;
  private silenceBlocks = 0;
  private utterance: Float32Array[] = [];
  private utteranceLen = 0;
  private noiseFloor = 0.01;
  /** set by the panel while SHE is talking — self-hearing suppression */
  muted = false;

  onTranscript: (text: string) => void = () => {};
  onDiag: (msg: string) => void = () => {};
  onLevel: (level: number) => void = () => {};
  onState: (listening: boolean) => void = () => {};
  onHearing: (activelyHearing: boolean) => void = () => {};

  get listening() { return this.running; }

  /** Swap the underlying model (downloads once, then cached). */
  async setQuality(q: EarQuality): Promise<boolean> {
    const model = EAR_MODELS[q];
    if (model === this.asrModel && this.asr) return true;
    try {
      this.asr = await this.loadPipeline(model);
      this.asrModel = model;
      this.onDiag(`LOCAL EARS: voice brain upgraded to ${q.toUpperCase()} (${model.split("/")[1]})`);
      return true;
    } catch (e) {
      this.onDiag(`LOCAL EARS: could not load ${q} model — staying on current`);
      return false;
    }
  }

  get quality(): EarQuality { return this.asrModel === EAR_MODELS.deep ? "deep" : "fast"; }

  private async loadPipeline(model: string, localBase?: string): Promise<AsrPipeline> {
    const tf = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<AsrPipeline>;
      env?: { allowLocalModels?: boolean; localModelPath?: string; backends?: { onnx?: { wasm?: { wasmPaths?: string } } } };
    };
    // air-gap: her models are LOCAL — allowLocalModels defaults to false in
    // browsers, which made every local whisper path an "invalid model ID"
    if (tf.env) {
      tf.env.allowLocalModels = true;
      tf.env.localModelPath = "/models/";
      if (tf.env.backends?.onnx?.wasm) { tf.env.backends.onnx.wasm.wasmPaths = "/vendor/ort/"; tf.env.backends.onnx.wasm.proxy = true; } // ORT runs in a worker — her panel never freezes while a brain loads
    }
    // WebGPU is 5-10x faster; fall back to WASM when unavailable
    for (const device of ["webgpu", "wasm"]) {
        // bare id: localModelPath provides "/models/" — a full path would double it
      const id = localBase ? localBase.split("/").pop()! : model;
      try {
        const pipe = await tf.pipeline("automatic-speech-recognition", id, {
          dtype: "q8",
          device,
          progress_callback: (p: { status?: string; progress?: number }) => {
            if (p?.status === "progress" && typeof p.progress === "number") {
              this.onDiag(`LOCAL EARS: voice model ${Math.round(p.progress)}%`);
            }
          },
        });
        this.onDiag(`LOCAL EARS: decoding via ${device.toUpperCase()}`);
        return pipe;
      } catch {
        /* try next device */
      }
    }
    throw new Error("no usable compute device");
  }

  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      if (!this.asr) {
        this.onDiag("LOCAL EARS: downloading the voice model once (~40-80 MB)...");
        this.asr = await this.loadPipeline(this.asrModel, LOCAL_BASE);
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ac = new AudioContext({ sampleRate: SR });
      this.src = this.ac.createMediaStreamSource(this.stream);
      this.node = this.ac.createScriptProcessor(BLOCK, 1, 1);
      this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
      this.src.connect(this.node);
      const mute = this.ac.createGain();
      mute.gain.value = 0; // capture only — never echo her mic back out
      this.node.connect(mute);
      mute.connect(this.ac.destination);

      this.running = true;
      this.onState(true);
      this.onDiag("LOCAL EARS ON — talk naturally, pause, she answers");
      return true;
    } catch (e) {
      this.onDiag(`LOCAL EARS FAILED: ${e instanceof Error ? e.message : String(e)}`);
      this.stop();
      return false;
    }
  }

  private onAudio(chunk: Float32Array) {
    if (!this.running) return;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    const threshold = Math.max(0.012, this.noiseFloor * 3);
    this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
    this.onLevel(Math.min(1, rms * 10));

    // she is talking → her own voice must never enter her ears
    if (this.muted) {
      if (this.utteranceLen > 0) { this.utterance = []; this.utteranceLen = 0; this.speaking = false; }
      this.onHearing(false);
      return;
    }

    if (rms > threshold) {
      if (!this.speaking) this.onHearing(true);
      this.speaking = true;
      this.silenceBlocks = 0;
    }
    if (!this.speaking) return;

    this.utterance.push(new Float32Array(chunk));
    this.utteranceLen += chunk.length;
    if (rms <= threshold) this.silenceBlocks++;

    if (this.silenceBlocks >= SILENCE_TAIL_BLOCKS || this.utteranceLen >= MAX_UTTERANCE) {
      void this.finalize();
    }
  }

  private async finalize() {
    this.speaking = false;
    this.silenceBlocks = 0;
    this.onHearing(false);
    const chunks = this.utterance;
    const len = this.utteranceLen;
    this.utterance = [];
    this.utteranceLen = 0;
    if (!this.asr || len < MIN_UTTERANCE) return;

    if (this.busy) {
      // never drop speech: merge into the next decode instead
      this.utterance = chunks;
      this.utteranceLen = len;
      return;
    }
    this.busy = true;
    const t0 = performance.now();
    try {
      const pcm = new Float32Array(len);
      let off = 0;
      for (const c of chunks) { pcm.set(c, off); off += c.length; }
      const out = await this.asr(pcm);
      const text = (out?.text ?? "").trim();
      if (text) {
        this.onDiag(`heard you in ${Math.round(performance.now() - t0)} ms`);
        this.onTranscript(text);
      } else {
        this.onDiag("heard something — could not make out words");
      }
    } catch (e) {
      this.onDiag(`LOCAL EARS decode error: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.busy = false;

    // anything that accumulated while decoding gets decoded now
    if (this.utteranceLen >= MIN_UTTERANCE) void this.finalize();
  }

  stop() {
    this.running = false;
    this.speaking = false;
    this.utterance = [];
    this.utteranceLen = 0;
    try { this.node?.disconnect(); } catch { /* noop */ }
    try { this.src?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ac?.close().catch(() => {});
    this.ac = null;
    this.node = null;
    this.src = null;
    this.onState(false);
    this.onHearing(false);
  }
}
