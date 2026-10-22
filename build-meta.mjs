// find WHICH env.js copies end up in the bundle (two copies = mutations split)
import * as esbuild from "esbuild";
import fs from "fs";

const stub = "C:/Users/self_/ZOLA-standalone/vendor-src/shims/node-builtins.ts";
const result = await esbuild.build({
  entryPoints: ["vendor-src/kokoro-local.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "public/vendor/kokoro.web.js",
  metafile: true,
  plugins: [{
    name: "shims",
    setup(build) {
      build.onResolve({ filter: /^node:/ }, () => ({ path: stub }));
      build.onResolve({ filter: /^sharp$/ }, () => ({ path: stub }));
      build.onResolve({ filter: /onnxruntime-node/ }, () => ({ path: stub }));
    },
  }],
});
const envFiles = Object.keys(result.metafile.inputs).filter((f) => /env\.js/i.test(f));
for (const f of envFiles) console.log("ENV FILE:", f);
console.log("total inputs:", Object.keys(result.metafile.inputs).length);
fs.writeFileSync("meta-analysis.txt", envFiles.join("\n"));
