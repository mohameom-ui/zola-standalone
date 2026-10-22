import('playwright').then(async ({ chromium }) => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
  const input = p.locator('input[name="cmd"]');
  await input.waitFor({ timeout: 30000 });
  await p.getByText(/HER SENSES/).first().click();
  await p.waitForTimeout(400);
  const drawer = p.locator('details', { hasText: 'HER SENSES' });
  await drawer.getByText(/^NEURAL VOICE$/).first().click({ force: true, timeout: 10000 });
  console.log('voice clicked (force) — polling her diag for 5 min');
  let seen = '';
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(5000);
    const text = await p.locator('body').innerText();
    const diag = text.match(/NEURAL VOICE[^\n]*/i);
    const fresh = diag && !seen.includes(diag[0]) ? diag[0].slice(0, 160) : null;
    if (fresh) { console.log(`[t+${i * 5}s]`, fresh); seen += fresh; }
    if (/NEURAL VOICE: online/i.test(text) || /NEURAL VOICE · ON/i.test(text)) { console.log(`VOICE ON at t+${i * 5}s`); break; }
    if (/NEURAL VOICE (failed|not reachable)[^\n]*/i.test(text) && i > 6) { console.log('VOICE FAILED — see diag above'); break; }
  }
  await b.close();
});
