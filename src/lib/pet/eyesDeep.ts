// ============================================================================
// DRONE PET — Deep Eyes (vision-language model, on-device)
// SmolVLM-256M via transformers.js: she can DESCRIBE what she sees in plain
// language — objects her detector has no name for, scenes, relations.
// One-time download (~250-400 MB), then offline. Falls back gracefully:
// if not loaded, her normal perception stack answers instead.
// ============================================================================

type VlmPipeline = (
  input: unknown,
  opts?: Record<string, unknown>,
) => Promise<unknown>;

// verified: this repo ships official ONNX (onnx/decoder_model_merged*.onnx)
const VLM_LOCAL = "/models/smolvlm-256m";
const VLM_MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";

export class DeepEyes {
  private vlm: VlmPipeline | null = null;
  loaded = false;
  busy = false;

  onDiag: (m: string) => void = () => {};

  async load(): Promise<boolean> {
    if (this.loaded) return true;
    this.onDiag("DEEP EYES: downloading her seeing brain once (~300 MB)...");
    try {
      const tf = (await import("@huggingface/transformers")) as unknown as {
        pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<VlmPipeline>;
      };
      this.vlm = await tf.pipeline("image-text-to-text", VLM_LOCAL, {
        dtype: "q4f16", // verified: decoder_model_merged_q4f16.onnx exists upstream
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p?.status === "progress" && typeof p.progress === "number") {
            this.onDiag(`DEEP EYES: download ${Math.round(p.progress)}%`);
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
      const prompt = question ?? "Describe what you see in this image in one or two sentences.";
      const out = (await this.vlm(
        { image, text: prompt },
        { max_new_tokens: 90, do_sample: false },
      )) as unknown;
      const arr = Array.isArray(out) ? out : [out];
      const first = arr[0] as { generated_text?: unknown } | undefined;
      let text = "";
      if (typeof first?.generated_text === "string") text = first.generated_text;
      else if (first?.generated_text && typeof first.generated_text === "object") {
        const g = first.generated_text as Record<string, unknown>[];
        const last = g[g.length - 1];
        if (last && typeof last.content === "string") text = last.content;
      }
      return text.trim() || null;
    } catch (e) {
      this.onDiag(`DEEP EYES error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
