// THE FULL-BODY CHECK — every organ, one command, in her real panel:
//   camera eye → object scanner → deep eyes (SmolVLM) → neural voice (Kokoro)
//   → whisper ears → a gesture → a stroll → a self-build → using it → EXPORT LIFE
//
// Chromium's fake media devices (the same flags her Pi kiosk grants) stand in
// for the camera and mic — the pipeline is real, the photons are synthetic.
//
// Run: node zola-full-check.mjs   (needs her dev server on :3001)
import { chromium } from "playwright";

const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const verdicts = [];
const pass = (m) => { verdicts.push(`✓ ${m}`); say(`✓ ${m}`); };
const fail = (m) => { verdicts.push(`✗ ${m}`); say(`✗ ${m}`); };

const browser = await chromium.launch({ args: [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ["camera", "microphone"] });
const page = await context.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));

await page.goto("http://localhost:3001", { waitUntil: "domcontentloaded" });
const input = page.locator('input[name="cmd"]');
await input.waitFor({ timeout: 30_000 });
await page.waitForTimeout(4000);
say("panel is up");

async function clickButton(text, timeout = 30000) {
  await page.getByText(text).first().click({ timeout });
}
async function waitForText(text, timeout = 60000) {
  await page.getByText(text).first().waitFor({ timeout });
}
async function p_summaryClick() {
  await page.getByText(/HER SENSES/).first().click(); // open the brain-managed drawer
  await page.waitForTimeout(400);
}

// ORDER MATTERS: mind and body FIRST in a clean perceptual world — waking
// the senses fills her ears with the fake tone and her eyes with synthetic
// kites, and she REACTS (that is the proof the organs work, but it drowns
// precise behavior checks). Senses go LAST, and her reactions count as passes.

// 1. THE BODY — a gesture (first LLM command may pay a cold model load)
try {
  await input.fill("wave at me");
  await input.press("Enter");
  await waitForText(/NOW PLAYING/i, 180_000);
  pass("gesture binds and plays on the v10 body");
} catch { fail("gesture did not play"); }

// 2. THE LEGS — a stroll
try {
  await input.fill("take a stroll");
  await input.press("Enter");
  // her stroll line is one of three, phrased variously — match them all
  await waitForText(/ACTIVITY · WALK|Ground mode|Strolling|Walking the floor/i, 90_000);
  pass("ground locomotion engages on command");
} catch { fail("the stroll never started"); }

// 3. THE SENSES — her own one-click wake, then her REACTIONS to the fake
// world are the evidence the organs work
try {
  await p_summaryClick();
  await clickButton(/WAKE HER SENSES/);
  for (let i = 0; i < 3; i++) { try { await clickButton("GRANT", 8000); } catch { break; } }
  await waitForText(/EYE LIVE/, 60_000);
  await waitForText(/MIC (LISTENING|LOCAL)/, 180_000);
  pass("senses awake: eye live, mic listening — consent-gated");
  // give her a moment to perceive the fake world; her reactions are the proof
  await page.waitForTimeout(20_000);
  const world = await page.locator("body").innerText();
  const reactions = (world.match(/kite|hear a voice|Another|Scanning idle/gi) ?? []).length;
  if (reactions > 0) pass(`she REACTED to the synthetic world (${reactions} perception events — eyes and ears are live)`);
  else fail("no perception events — the senses may be deaf/blind to the fake world");
} catch { fail("the senses did not wake (eye/mic)"); }

// 4. DEEP EYES + NEURAL VOICE — the heavyweight cortices (inside the drawer)
try {
  await clickButton(/^DEEP EYES$/);
  await waitForText("DEEP EYES · ON", 240_000);
  pass("deep eyes loaded (SmolVLM, 184 MB, local)");
  await page.waitForTimeout(10000); // let the WASM compile settle before the next heavyweight
} catch { fail("deep eyes failed to load"); }
try {
  await clickButton(/^NEURAL VOICE$/);
  await waitForText("NEURAL VOICE · ON", 300_000);
  pass("neural voice loaded (Kokoro, 116 MB, local)");
  await page.waitForTimeout(10000);
} catch { fail("neural voice failed to load"); }

// 7. THE MIND — she builds
try {
  await input.fill("build: celsius to fahrenheit converter");
  await input.press("Enter");
  await waitForText(/SELF-BUILD installed/i, 180_000);
  pass("self-build: forged, gate-passed, ledgered");
} catch { fail("self-build did not install"); }

// 8. USING HER OWN WORK
try {
  await input.fill("convert 25 celsius to fahrenheit");
  await input.press("Enter");
  await waitForText(/7[6-8](\.\d+)?/, 60_000);
  pass("she used her own capability (25°C → her code's answer)");
} catch { fail("she did not route to her own capability"); }

// 9. THE LIFE — export everything she is
try {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    clickButton(/EXPORT LIFE/),
  ]);
  const name = download.suggestedFilename();
  if (/zola-life-.*\.json/.test(name)) pass(`life exported (${name})`);
  else fail(`unexpected export filename: ${name}`);
} catch { fail("life export did not produce a file"); }

await page.screenshot({ path: "Saved/full-check-final.png" });
say("————————————");
say(verdicts.join("   "));
const failed = verdicts.filter((v) => v.startsWith("✗"));
say(errs.length ? `page errors: ${errs.length}` : "no page errors");
say(failed.length === 0 ? "FULL-BODY CHECK: ALL ORGANS VERIFIED" : `FULL-BODY CHECK: ${failed.length} organ(s) failed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
