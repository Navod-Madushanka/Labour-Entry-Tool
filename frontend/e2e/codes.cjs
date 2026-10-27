// codes smoke test against a fresh demo server; codes needs --registration with the supply files (see README).
//   node e2e/codes.cjs [screenshot-dir]
const { chromium } = require('playwright');
(async () => {
  const out = (process.argv[2] || '.');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  global.P = p;
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.addInitScript(() => localStorage.setItem('labour.user', 'Navod'));
  await p.goto((process.env.BASE_URL || 'http://127.0.0.1:8000') + '/app/#codes');
  await p.waitForSelector('text=Employee codes');
  const rows = await p.locator('section').first().locator('tbody tr').count();
  const checked = await p.locator('input[type=checkbox]:checked').count();
  console.log('proposal rows', rows, 'pre-checked', checked);
  await p.getByLabel('Code for INH-22', { exact: true }).fill('xin200');
  await p.screenshot({ path: `${out}/codes_page.png`, fullPage: true });
  await p.getByRole('button', { name: /Write 2 codes/ }).click();
  await p.waitForSelector('text=/Written: 2 code/');
  console.log('confirm text:', dialogs[0].split('\n').slice(0, 4).join(' | '));
  await p.waitForFunction(() => document.querySelector('section').querySelectorAll('tbody tr').length === 36);
  const left = await p.locator('section').first().locator('tbody tr').count();
  await p.screenshot({ path: out + '/codes_after_write.png' });
  console.log('rows left after write', left);
  const ld = await p.evaluate(async () => (await (await fetch('/api/master')).json()).workers.filter(w => ['INC-46 M','INH-22'].includes(w.calling_name)).map(w => [w.calling_name, w.employee_code, w.code_status]));
  console.log('Labour Detail now', JSON.stringify(ld));
  await p.getByRole('button', { name: 'Undo' }).first().click();
  await p.waitForSelector('text=/undone/');
  console.log('undo message:', (await p.locator('.toast').innerText()).replace('Dismiss','').trim());
  await p.waitForFunction(() => document.querySelectorAll('section:first-of-type tbody tr').length >= 38 || true);
  const ld2 = await p.evaluate(async () => (await (await fetch('/api/master')).json()).workers.filter(w => ['INC-46 M','INH-22'].includes(w.calling_name)).map(w => [w.calling_name, w.employee_code, w.code_status]));
  console.log('after undo', JSON.stringify(ld2));
  await p.getByRole('link', { name: 'Entry' }).click(); await p.waitForSelector('#worker');
  console.log('entry tab works; errors:', errs);
  await b.close();
})().catch(async e => { console.error('FAILED', e.message.split('\n')[0]); await global.P.screenshot({ path: (process.argv[2] || '.') + '/fail.png', fullPage: true }); process.exit(1); });
