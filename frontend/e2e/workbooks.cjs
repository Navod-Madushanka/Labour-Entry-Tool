// Several workbooks at once, and a workbook kept without activity codes.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/workbooks.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("select.workbook-pick");
  if (!(await p.locator('input[aria-label="Activity 1"]').count())) throw new Error("A should have activity boxes");
  console.log("A: activity boxes shown");
  // Switch to B: not checked yet -> start page, activity checks found off
  await p.selectOption("select.workbook-pick", { label: "Labour Entry Sheet October 2026 - DEMO B.json" });
  await p.waitForSelector("text=Check activity codes and hours");
  const on = await p.locator(".activity-toggle input").isChecked();
  console.log("B toggle checked:", on);
  await p.getByRole("button", { name: /^Continue/ }).click();
  await p.waitForSelector("text=Not used in this workbook");
  await p.screenshot({ path: out + "/b-ready.png", fullPage: true });
  await p.getByRole("button", { name: /Start entering data|Start anyway/ }).click();
  await p.waitForSelector("#worker");
  if (await p.locator('input[aria-label="Activity 1"]').count()) throw new Error("B should have no activity boxes");
  await p.getByRole('tab', { name: '5', exact: true }).click();
  await p.locator('#worker').fill('BBB-10'); await p.keyboard.press('Enter');
  await p.keyboard.type('7'); await p.keyboard.press('Enter');
  await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.waitForSelector('.queue tbody tr');
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled);
  await p.screenshot({ path: out + "/b-entry.png", fullPage: true });
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const day = await p.evaluate(async () => (await (await fetch('/api/days/5')).json()).entries.map(v => [v.entry.calling_name, v.issues.map(i => i.rule)]));
  console.log("B sheet 5 after push:", JSON.stringify(day));
  // Back to A: already checked -> straight to entry with activity boxes
  await p.selectOption("select.workbook-pick", { label: "Labour Entry Sheet October 2026 - DEMO A.json" });
  await p.waitForSelector('input[aria-label="Activity 1"]');
  console.log("A again: activity boxes shown; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
