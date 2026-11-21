#!/usr/bin/env node
// ============================================================================
// ZOLA — headless panel smoke test.
//
//   npx next start -p 3011
//   node Scripts/smoke-panel.mjs http://127.0.0.1:3011/ panel-smoke.png
//
// Loads the control panel in Chromium and separates two kinds of failure:
//
//   hard  — JavaScript exceptions, React errors. The page is broken.
//   net   — refused sockets, 4xx/5xx. Often environmental: the MAVLink relay
//           (:8002) and the gitignored public/models/ weights are not present
//           in a bare checkout, and that is expected.
//
// Exits non-zero only on hard errors, so the test is meaningful on a dev box
// without a drone tethered to it.
// ============================================================================

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:3011/";
const shot = process.argv[3] ?? "panel-smoke.png";

const hard = [];
const net = new Map();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on("pageerror", (e) => hard.push(`pageerror: ${String(e)}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // transport failures are environmental here: no relay (:8002), no Ollama
  // (:11434), and public/models/ is not provisioned in a bare checkout
  if (/Failed to load resource|WebSocket connection|ERR_CONNECTION_REFUSED|net::ERR_/i.test(text)) return;
  hard.push(`console: ${text}`);
});
page.on("response", (r) => {
  if (r.status() >= 400) net.set(`${r.status()} ${r.url()}`, true);
});
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "failed";
  net.set(`${why} ${r.url()}`, true);
});

let status = 0;
try {
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  status = res?.status() ?? 0;
  await page.waitForTimeout(2_500);

  const title = await page.title();
  const body = await page.locator("body").innerText();
  const buttons = await page.locator("button").count();

  console.log(`status:      ${status}`);
  console.log(`title:       ${title}`);
  console.log(`buttons:     ${buttons}`);
  console.log(`mentions ZOLA: ${/zola/i.test(body)}`);
  console.log(`body chars:  ${body.length}`);

  await page.screenshot({ path: shot, fullPage: false });
  console.log(`screenshot:  ${shot}`);
} catch (e) {
  hard.push(`navigation: ${String(e)}`);
} finally {
  await browser.close();
}

if (net.size > 0) {
  console.log(`\n${net.size} network issue(s) — environmental unless listed as 500:`);
  for (const key of [...net.keys()].slice(0, 12)) console.log(` - ${key}`);
}

if (hard.length > 0) {
  console.error(`\n${hard.length} hard error(s):`);
  for (const e of hard.slice(0, 12)) console.error(` - ${e}`);
  process.exit(1);
}
console.log("\nno JavaScript errors");
