// ============================================================================
// DRONE PET — Deep Eyes (vision-language model, on-device)
// SmolVLM-256M via transformers.js: she can DESCRIBE what she sees in plain
// language — objects her detector has no name for, scenes, relations.
// One-time download (~250-400 MB), then offline. Falls back gracefully:
// if not loaded, her normal perception stack answers instead.
// ============================================================================

// the low-level SmolVLM pair (this transformers build has no VLM pipeline)
type SmolTokenizer = { decode: (t: unknown, o?: Record<string, unknown>) => string };
type SmolProcessor = {
  (text: string, image: unknown): Promise<Record<string, unknown>>;
  tokenizer?: SmolTokenizer;
};
type SmolModel = (inputs: Record<string, unknown>) => Promise<unknown>;

// verified: this repo ships official ONNX (onnx/decoder_model_merged*.onnx)
// BARE id — env.localModelPath = "/models/" provides the directory
const VLM_LOCAL = "smolvlm-256m";
const VLM_MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";

export class DeepEyes {
  private vlm: SmolModel | null = null;
  private processor: SmolProcessor | null = null;
  loaded = false;
  busy = false;

  onDiag: (m: string) => void = () => {};

  async load(): Promise<boolean> {
    if (this.loaded) return true;
    this.onDiag("DEEP EYES: loading her seeing brain from local files...");
    try {
      const tf = (await import("@huggingface/transformers")) as unknown as {
        AutoProcessor: { from_pretrained: (m: string, o?: Record<string, unknown>) => Promise<SmolProcessor> };
        AutoModelForImageTextToText: { from_pretrained: (m: string, o?: Record<string, unknown>) => Promise<SmolModel> };
        env?: { allowLocalModels?: boolean; localModelPath?: string; backends?: { onnx?: { wasm?: { wasmPaths?: string; proxy?: boolean } } } };
      };
      // air-gap: her models are LOCAL — transformers.js defaults to
      // allowLocalModels=false in browsers (treats paths as Hub ids), which
      // refused every local file ("download aborted due to invalid model ID")
      if (tf.env) {
        tf.env.allowLocalModels = true;
        tf.env.localModelPath = "/models/";
        if (tf.env.backends?.onnx?.wasm) { tf.env.backends.onnx.wasm.wasmPaths = "/vendor/ort/"; tf.env.backends.onnx.wasm.proxy = true; } // ORT runs in a worker — her panel never freezes while a brain loads
      }
      // LOW-LEVEL API: this transformers build has no image-text-to-text
      // pipeline (proven live), but the SmolVLM architecture is fully exported
      // — the processor+model pair is the same thing the pipeline would wrap
      this.processor = await tf.AutoProcessor.from_pretrained(VLM_LOCAL);
      this.vlm = await tf.AutoModelForImageTextToText.from_pretrained(VLM_LOCAL, {
        dtype: "q4f16", // verified: decoder_model_merged_q4f16.onnx exists upstream
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p?.status === "progress" && typeof p.progress === "number") {
            this.onDiag(`DEEP EYES: loading ${Math.round(p.progress)}%`);
          }
        },
      });
      this.loaded = true;
      this.onDiag(`DEEP EYES: online (${VLM_MODEL.split("/")[1]}) — she can now describe anything`);
      return true;
    } catch (e) {
      this.onDiag(`DEEP EYES failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Describe the current frame. Pass the live <video> element; the frame is
   * captured, never stored — only the description text comes back out.
   */
  async describe(video: HTMLVideoElement, question?: string): Promise<string | null> {
    if (!this.vlm || this.busy) return null;
    if (!video.videoWidth) return null;
    this.busy = true;
    try {
      // capture the current frame to a canvas (in memory, discarded after)
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = Math.max(64, Math.round((512 * video.videoHeight) / video.videoWidth));
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
      if (!blob) return null;

      const tf = (await import("@huggingface/transformers")) as unknown as {
        RawImage: { fromBlob: (b: Blob) => Promise<unknown> };
      };
      const image = await tf.RawImage.fromBlob(blob);
      // SmolVLM's chat format: the question is her instruction, the image is
      // the scene — the processor builds pixel_values + input_ids together
      const prompt = `<|user|>\n${question ?? "Describe what you see in this image in one or two sentences."}<|end_of_text|>\n<|assistant|>\n`;
      const proc = this.processor;
      const model = this.vlm;
      if (!proc || !model) return null;
      const inputs = (await proc(prompt, image)) as Record<string, unknown>;
      const out = (await model({
        ...inputs,
        max_new_tokens: 90,
        do_sample: false,
      })) as unknown;
      // the low-level generate returns TOKEN IDS — decode via her tokenizer
      const tokenizer = proc.tokenizer;
      if (!tokenizer) return null;
      const decoded = tokenizer.decode(out, { skip_special_tokens: true });
      // strip the echo of her instruction if the decoder keeps it
      const text = decoded.replace(/^[\s\S]*?<end_of_utterance>\s*/i, "").replace(/Assistant:\s*/i, "").trim();
      return text || null;
    } catch (e) {
      this.onDiag(`DEEP EYES error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
