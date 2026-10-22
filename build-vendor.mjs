// REBAKES public/vendor/kokoro.web.js with her env baked in + browser shims
// for the node-only paths (fs/path/url/sharp...) that kokoro-js's transformers
// references. Run: node build-vendor.mjs
import * as esbuild from "esbuild";
import path from "path";

const stub = path.resolve("vendor-src/shims/node-builtins.ts");

await esbuild.build({
  entryPoints: ["vendor-src/kokoro-local.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "public/vendor/kokoro.web.js",
  plugins: [{
    name: "browser-shims",
    setup(build) {
      build.onResolve({ filter: /^node:/ }, () => ({ path: stub }));
      build.onResolve({ filter: /^sharp$/ }, () => ({ path: stub }));
      build.onResolve({ filter: /onnxruntime-node/ }, () => ({ path: stub }));
    },
  }],
});
console.log("kokoro.web.js rebaked");
