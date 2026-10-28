// UI smoke test (PLAN.md §9, optional): the keyboard entry flow against a demo server.
//
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   npm i --no-save playwright && npx playwright install chromium
//   node e2e/ui-smoke.cjs [screenshot-dir]
//
// Uses sheets 25-31 of the October INDIAN snapshot (empty there) and sheets 4/31 for headers.
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000/";

async function keyboardFlow(out) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; global.P = p; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(BASE);
  await p.getByPlaceholder('Your name').fill('Tester'); await p.keyboard.press('Enter');
  await p.waitForSelector('.modal', { state: 'detached' });
  await p.getByRole('tab', { name: '26', exact: true }).click();
  await p.waitForSelector('text=Sheet 26');
  const code = await p.evaluate(async () => (await (await fetch('/api/master')).json()).activities[0]);
  // keyboard flow: worker -> In -> Out -> activity -> hours -> Enter
  await p.locator('#worker').fill('inb0'); await p.keyboard.press('Enter'); // top match INB-01
  await p.keyboard.type('7'); await p.keyboard.press('Enter');
  await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.keyboard.type(code); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('.big-number')?.textContent?.startsWith('11 '));
  await p.keyboard.press('Enter'); // hours prefilled with remaining 11 on focus; Enter queues
  await p.waitForSelector('.queue tbody tr');
  // next worker keeps times and activity
  await p.keyboard.type('INB-02'); await p.keyboard.press('Enter');
  await p.locator('#worker').focus();
  await p.waitForFunction(() => document.querySelector('.big-number')?.textContent?.startsWith('11 '));
  await p.locator('[aria-label="Hours 1"]').press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 2);
  await p.waitForFunction(() => [...document.querySelectorAll('.queue .pill.ok')].length === 2, null, {timeout: 10000});
  await p.screenshot({ path: `${out}/ui_queue.png`, fullPage: true });
  await p.getByRole('button', { name: /Push 2 entries/ }).click();
  await p.waitForSelector('.result.ok');
  console.log('result:', (await p.locator('.result-head strong').textContent()));
  await p.waitForFunction(() => document.querySelectorAll('.daylist tbody tr').length === 2);
  console.log('status unsaved:', await p.locator('.badge.warn').first().textContent());
  await p.screenshot({ path: `${out}/ui_written.png`, fullPage: true });
  // undo
  p.on('dialog', d => d.accept());
  await p.getByRole('button', { name: 'Undo' }).first().click();
  await p.waitForSelector('text=undone');
  await p.waitForFunction(() => !document.querySelector('.daylist tbody tr'));
  console.log('after undo day list empty: ok');
  // header banner on sheet 4
  await p.getByRole('tab', { name: '4', exact: true }).click();
  await p.waitForSelector('.banner.BLOCK');
  console.log('banner:', (await p.locator('.banner li').first().textContent()).slice(0, 80));
  await p.screenshot({ path: `${out}/ui_banner.png` });
  // phone width check
  await p.setViewportSize({ width: 390, height: 900 });
  console.log('phone scrollWidth', await p.evaluate(() => document.documentElement.scrollWidth));
  console.log('errors:', errs);
  await b.close();
}

async function crewEditHeader(out) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  global.P = p;
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.getByPlaceholder('Your name').fill('Tester'); await p.keyboard.press('Enter');
  await p.waitForSelector('.modal', { state: 'detached' });
  await p.waitForFunction(() => !document.body.innerText.includes('Loading month'), null, { timeout: 30000 });
  console.log('month fully loaded');
  // crew entry on sheet 28 with the form's times
  await p.getByRole('tab', { name: '28', exact: true }).click();
  const code = await p.evaluate(async () => (await (await fetch('/api/master')).json()).activities[0]);
  await p.locator('#in').fill('07:00'); await p.locator('#out').fill('17:00');
  await p.locator('[aria-label="Activity 1"]').fill(code); await p.locator('[aria-label="Hours 1"]').fill('9');
  await p.getByRole('button', { name: /Crew entry/ }).click();
  await p.getByLabel('Trade group').selectOption('Rigger');
  await p.getByRole('button', { name: /Select all shown/ }).click();
  await p.getByRole('button', { name: /^Queue \d+ with/ }).click();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length >= 6);
  const n = await p.locator('.queue tbody tr').count();
  await p.waitForFunction(() => !document.body.innerText.includes('checking…'));
  console.log('crew queued', n, 'ready', await p.locator('.queue .pill.ok').count());
  await p.getByRole('button', { name: new RegExp(`Push ${n} entries`) }).click();
  await p.waitForSelector('.result.ok');
  console.log('crew result:', await p.locator('.result-head strong').textContent());
  // copy yesterday (sheet 28 <- 27 empty, so use sheet 2 <- 1): suggestion button for a worker
  await p.getByRole('tab', { name: '25', exact: true }).click();
  await p.locator('#worker').fill('INB-03'); await p.keyboard.press('Enter');
  const copy = p.getByRole('button', { name: /Copy day 24/ });
  console.log('copy-yesterday suggestion:', await copy.textContent());
  await copy.click();
  console.log('form after copy: in', await p.locator('#in').inputValue(), 'out', await p.locator('#out').inputValue());
  // edit an existing entry from the day list (overwrite) and see E08 not blocking
  await p.getByRole('tab', { name: '28', exact: true }).click();
  await p.locator('.daylist tbody tr').first().getByRole('button', { name: 'Edit' }).click();
  await p.waitForSelector('text=Editing the existing entry');
  await p.locator('#out').fill('18:00'); await p.locator('#out').press('Enter');
  await p.locator('[aria-label="Hours 1"]').fill('10'); await p.locator('[aria-label="Hours 1"]').press('Enter');
  await p.waitForFunction(() => document.querySelector('.queue .pill.ok'));
  console.log('edit queued:', (await p.locator('.queue tbody tr').first().innerText()).replace(/\s+/g, ' '));
  // header fix on sheet 31
  await p.getByRole('button', { name: 'Remove all' }).click();
  await p.getByRole('tab', { name: '31', exact: true }).click();
  await p.waitForSelector('.banner');
  await p.getByRole('button', { name: /^Fix / }).click();
  await p.waitForSelector('text=Header of sheet 31 fixed');
  await p.waitForFunction(() => !document.querySelector('.banner'));
  console.log('header fixed: banner gone; day type now', await p.locator('.dayinfo .badge').textContent());
  await p.screenshot({ path: `${out}/ui_after_fix.png`, fullPage: true });
  console.log('errors:', errs);
  await b.close();
}

(async () => {
  const out = process.argv[2] || ".";
  await keyboardFlow(out);
  await crewEditHeader(out);
  console.log("UI smoke test passed");
})().catch(async (e) => {
  console.error("FAILED", e.message.split("\n")[0]);
  try {
    await global.P.screenshot({ path: (process.argv[2] || ".") + "/ui_fail.png", fullPage: true });
  } catch {}
  process.exit(1);
});
