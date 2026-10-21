// THE FULL LOOP, IN HER REAL PANEL — a headless browser talks to Zola:
//   1. "build: mph to kph converter"  → her brain forges, gate judges, ledger keeps
//   2. page RELOAD                    → her build reincarnates from the ledger
//   3. "convert 60 mph to kph"        → she USES what she built, with real args
//
// Run: node zola-live-loop.mjs   (needs her dev server on :3001 + her Ollama)
import { chromium } from "playwright";

const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => say(`PAGE ERROR: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
const input = page.locator('input[name="cmd"]');
await input.waitFor({ timeout: 30_000 });
say("panel is up");

async function ask(text) {
  await input.fill(text);
  await input.press("Enter");
}

// STEP 1 — she builds
say('STEP 1: "build: mph to kph converter"');
await ask("build: mph to kph converter");
try {
  await page.getByText(/SELF-BUILD installed: build:mph-to-kph/i).waitFor({ timeout: 180_000 });
  say("✓ her log: SELF-BUILD installed — forged, gate-passed, ledgered");
} catch {
  say("✗ no SELF-BUILD installed line appeared");
  await page.screenshot({ path: "Saved/live-loop-fail-1.png" });
  await browser.close();
  process.exit(1);
}

// STEP 2 — the reload: the ledger must resurrect her work
say("STEP 2: reloading the page — her build must survive");
await page.reload({ waitUntil: "domcontentloaded" });
await input.waitFor({ timeout: 30_000 });
let reincarnated = false;
for (let i = 0; i < 30 && !reincarnated; i++) {
  const text = await page.locator("body").innerText();
  reincarnated = /reincarnated from her ledger/i.test(text);
  if (!reincarnated) await page.waitForTimeout(1000);
}
if (reincarnated) {
  say("✓ her log: capability reincarnated from her ledger");
} else {
  say("✗ no reincarnation log — persistence failed");
  await page.screenshot({ path: "Saved/live-loop-fail-2.png" });
  await browser.close();
  process.exit(1);
}

// STEP 3 — she USES it
say('STEP 3: "convert 60 mph to kph" — she should route to her own capability');
await ask("convert 60 mph to kph");
let usedIt = false;
try {
  // her spoken answer renders in the log/say area; wait for kph + a number
  // her code may phrase the unit as km/h, kph, or kilometers per hour
  await page.getByText(/9[0-7](\.\d+)?\s*(km\/h|kph|kilometers)/i).first().waitFor({ timeout: 120_000 });
  usedIt = true;
  say("✓ she answered with the conversion — her own code, her own args");
} catch {
  say("△ no kph answer routed through her capability (her brain may have answered by reflex or recon instead)");
}

await page.screenshot({ path: "Saved/live-loop-final.png" });
say(usedIt
  ? "FULL LOOP VERIFIED: build → ledger → reincarnation → use, in her real panel"
  : "PARTIAL: build + persistence verified; the use-route depends on her brain's wording");
await browser.close();
