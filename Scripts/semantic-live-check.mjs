#!/usr/bin/env node
// ============================================================================
// ZOLA — does the browser actually load the local embedder?
//
//   node Scripts/fetch-embedder.mjs      # once, ~23 MB
//   npx next start -p 3019
//   node Scripts/semantic-live-check.mjs http://127.0.0.1:3019/
//
// The loader writes to her in-app log, not the console, so this polls the
// rendered text. Manual check: it needs the model on disk (gitignored), so CI
// cannot run it.
// ============================================================================

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:3019/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

let found = null;
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(5_000);
  const body = await page.locator("body").innerText();
  const match = body.match(/semantic memory[^\n]*/i);
  if (match) { found = match[0]; break; }
  console.log(`  ${(i + 1) * 5}s — not yet`);
}

if (errors.length > 0) console.log(`page errors: ${errors.length}`);
await browser.close();

if (!found) {
  console.log("semantic memory never reported (still warming up, or the model is missing)");
  process.exit(1);
}
console.log(`seen: ${found}`);
process.exit(/online/i.test(found) ? 0 : 1);
