// medical smoke test against a fresh demo server; codes needs --registration with the supply files (see README).
//   node e2e/medical.cjs [screenshot-dir]
const { chromium } = require('playwright');
(async () => {
  const out = (process.argv[2] || '.');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  global.P = p;
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.addInitScript(() => localStorage.setItem('labour.user', 'Navod'));
  await p.goto((process.env.BASE_URL || 'http://127.0.0.1:8000') + '/');
  await p.getByRole('tab', { name: '26', exact: true }).click();
  await p.getByRole('button', { name: /Medical leave/ }).click();
  await p.locator('#med-worker').fill('INC-08');
  await p.waitForSelector('.medical-plan tbody tr');
  const rows = await p.locator('.medical-plan tbody tr').count();
  console.log('days in dialog', rows);
  console.log('notes:', (await p.locator('.medical-plan').innerText()).split('\n').slice(0, 4).join(' | '));
  await p.screenshot({ path: `${out}/medical_dialog.png` });
  // sheet 31 has header problems (H02/H03): tick confirmable ones
  for (const cb of await p.locator('.medical-plan input[type=checkbox]').all()) await cb.check();
  await p.waitForFunction(() => document.querySelectorAll('.medical-plan .ok-text').length === document.querySelectorAll('.medical-plan tbody tr').length);
  await p.getByRole('button', { name: /Add INC-08 M and write/ }).click();
  await p.waitForSelector('.modal .result.ok');
  console.log('result:', await p.locator('.modal .result').innerText());
  await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await p.waitForFunction(() => [...document.querySelectorAll('.daylist tbody tr')].some(r => r.innerText.includes('INC-08 M')));
  console.log('day list shows INC-08 M:', (await p.locator('.daylist tbody tr', { hasText: 'INC-08 M' }).innerText()).replace(/\s+/g, ' '));
  await p.locator('#worker').fill('INC-08 M'); await p.waitForSelector('#worker-list li');
  console.log('worker search finds:', (await p.locator('#worker-list li').first().innerText()).replace(/\s+/g, ' '));
  await p.keyboard.press('Escape');
  const batches = await p.locator('.batches li').allInnerTexts();
  console.log('batches:', batches.map(t => t.replace(/\s+/g, ' ').slice(0, 70)));
  await p.locator('.batches li').first().getByRole('button', { name: 'Undo' }).click();   // entries
  await p.waitForSelector('text=/Batch #2 undone/');
  await p.locator('.batches li', { hasText: 'new worker' }).getByRole('button', { name: 'Undo' }).click();
  await p.waitForSelector('text=/Batch #1 undone/');
  const still = await p.evaluate(async () => (await (await fetch('/api/master')).json()).workers.some(w => w.calling_name === 'INC-08 M'));
  console.log('INC-08 M still in Labour Detail after both undos:', still, '| errors:', errs);
  await b.close();
})().catch(async e => { console.error('FAILED', e.message.split('\n')[0]); await global.P.screenshot({ path: (process.argv[2] || '.') + '/fail.png', fullPage: true }); process.exit(1); });
