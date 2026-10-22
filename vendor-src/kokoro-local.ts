// her self-contained voice bundle, REBAKED: the REAL env (the same module
// instance kokoro-js's fetch layer reads) is patched at module scope — the
// shipped bundle exported a SHIM that only exposed wasmPaths, so every env
// mutation from outside was invisible and the voice went to the Hub (401)
import { env } from "../node_modules/kokoro-js/node_modules/@huggingface/transformers/dist/transformers.web.js";
import { KokoroTTS } from "kokoro-js";
env.allowLocalModels = true;
env.localModelPath = "/models/";
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = "/vendor/ort/";
export { KokoroTTS, env };
