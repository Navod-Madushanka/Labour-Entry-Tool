// Day builder smoke test (needs a fresh demo server on the INDIAN snapshot, see ui-smoke.cjs).
//   node e2e/day-builder.cjs [screenshot-dir]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  global.P = p;
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.addInitScript(() => localStorage.setItem('labour.user', 'Navod'));
  await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8000/');
  await p.getByRole('tab', { name: '26', exact: true }).click();
  let t = Date.now();
  await p.getByRole('button', { name: 'Start day from previous days…' }).click();
  await p.waitForSelector('.crew');
  const crews = await p.locator('.crew').count(), members = await p.locator('.member').count(), ticked = await p.locator('.member input:checked').count();
  console.log(`built in ${Date.now() - t} ms: ${crews} crews, ${members} workers, ${ticked} ticked`);
  console.log('first crew:', (await p.locator('.crew').first().locator('.crew-head').innerText()).replace(/\s+/g, ' '));
  // crew-level edit: first crew goes home at 19:00
  await p.locator('.crew').first().getByLabel('Crew Out').fill('19:00');
  console.log('after edit:', (await p.locator('.crew').first().locator('.crew-head').innerText()).replace(/\s+/g, ' '));
  // one absent, one did something else
  await p.locator('.crew').first().locator('.member input').first().uncheck();
  await p.locator('.crew').first().getByRole('button', { name: /^Split / }).nth(1).click();
  console.log('crews after split:', await p.locator('.crew').count());
  await p.screenshot({ path: `${out}/builder.png` });
  const n = Number((await p.getByRole('button', { name: /Add \d+ entries/ }).innerText()).match(/\d+/)[0]);
  t = Date.now();
  await p.getByRole('button', { name: /Add \d+ entries/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll('.queue tbody tr').length === n && !document.body.innerText.includes('checking…'), n, { timeout: 60000 });
  console.log(`queued ${n}, checked in ${Date.now() - t} ms`);
  const bulk = await p.locator('.bulk button').allInnerTexts();
  console.log('bulk confirm buttons:', bulk);
  for (const btn of await p.locator('.bulk button').all()) await btn.click();
  await p.waitForFunction(() => !document.querySelector('.bulk'));
  const blocked = await p.locator('.queue tr.row-block').count();
  console.log('blocked after confirming warnings:', blocked);
  if (blocked) console.log('  e.g.', (await p.locator('.queue tr.row-block').first().innerText()).replace(/\s+/g, ' ').slice(0, 140));
  await p.screenshot({ path: `${out}/builder_queue.png` });
  if (!blocked) {
    t = Date.now();
    await p.getByRole('button', { name: /Write \d+ entries/ }).click();
    await p.waitForSelector('.result');
    console.log(`write: ${await p.locator('.result-head strong').innerText()} (${Date.now() - t} ms in browser)`);
  }
  console.log('errors:', errs);
  await b.close();
})().catch(async e => { console.error('FAILED', e.message.split('\n')[0]); await global.P.screenshot({ path: (process.argv[2] || '.') + '/fail.png', fullPage: true }); process.exit(1); });
