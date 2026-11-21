// ============================================================================
// ZOLA — local sentence embedder (semantic memory's engine)
//
// MiniLM, quantised, served from HER DISK. Remote model downloads are
// explicitly disabled: if the model is not provisioned under public/models/,
// semantic recall stays off and the lexical index answers. No silent network,
// no surprise uploads — the privacy contract applies to model weights too.
//
// Provision once:
//   node Scripts/fetch-embedder.mjs
// ============================================================================

type Extractor = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

export class LocalEmbedder {
  loaded = false;
  private extractor: Extractor | null = null;
  private loading: Promise<boolean> | null = null;
  private readonly cache = new Map<string, number[]>();

  constructor(readonly modelId = "all-MiniLM-L6-v2") {}

  get cached(): number {
    return this.cache.size;
  }

  async load(onDiag?: (m: string) => void): Promise<boolean> {
    if (this.loaded) return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const tf = (await import("@huggingface/transformers")) as unknown as {
          env: {
            allowRemoteModels: boolean;
            allowLocalModels: boolean;
            localModelPath: string;
            backends?: { onnx?: { wasm?: { wasmPaths?: string; proxy?: boolean } } };
          };
          pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
        };
        tf.env.allowRemoteModels = false;
        tf.env.allowLocalModels = true;
        tf.env.localModelPath = "/models/";
        // her vendored ORT, same as eyes/ears — never a CDN at runtime
        if (tf.env.backends?.onnx?.wasm) {
          tf.env.backends.onnx.wasm.wasmPaths = "/vendor/ort/";
          tf.env.backends.onnx.wasm.proxy = true;
        }
        this.extractor = (await tf.pipeline("feature-extraction", this.modelId, { dtype: "q8" })) as Extractor;
        this.loaded = true;
        onDiag?.("semantic memory online — meaning, not just words");
        return true;
      } catch (e) {
        onDiag?.(
          `semantic memory offline (${e instanceof Error ? e.message : String(e)}) — lexical recall only. ` +
            "Run: node Scripts/fetch-embedder.mjs",
        );
        return false;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Embed many strings, reusing the cache. Null when the model is not loaded. */
  async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.extractor) return null;
    const out: number[][] = [];
    for (const text of texts) {
      const hit = this.cache.get(text);
      if (hit) {
        out.push(hit);
        continue;
      }
      const res = await this.extractor(text, { pooling: "mean", normalize: true });
      const vec = Array.from(res.data);
      this.cache.set(text, vec);
      out.push(vec);
    }
    return out;
  }

  async embedOne(text: string): Promise<number[] | null> {
    const v = await this.embed([text]);
    return v?.[0] ?? null;
  }
}
