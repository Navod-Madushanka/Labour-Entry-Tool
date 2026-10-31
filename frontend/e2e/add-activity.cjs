// New activity codes from the Codes & registration tab, used in an entry, then undone.
//
//   python -m app.main --demo fixtures/sanitized/indian_2026-10.json    (fresh server)
//   node e2e/add-activity.cjs [screenshot-dir]
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + "/");
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.goto(BASE + "/app/#codes");
  await p.waitForSelector("#new-codes");
  const before = await p.evaluate(async () => (await (await fetch('/api/master')).json()).activities.length);
  await p.locator("#new-codes").fill("03-31-05-35-q, 03-11-00-00\n99-99-99-99-Q");
  const lines = await p.locator(".new-codes li").allInnerTexts();
  console.log("checked as typed:", lines.map((l) => l.replace(/\s+/g, " ")));
  if (!lines[1].includes("already in the list")) throw new Error("existing code not flagged");
  await p.locator(".activity-adder").screenshot({ path: out + "/add-activity.png" });
  await p.getByRole("button", { name: /^Add 2 codes to Labour Detail/ }).click();
  await p.waitForSelector(".activity-adder .banner.OK");
  console.log("result:", (await p.locator(".activity-adder .banner").innerText()).replace(/\s+/g, " "));
  const after = await p.evaluate(async () => (await (await fetch('/api/master')).json()).activities);
  console.log("list:", before, "->", after.length, "| last:", after.slice(-2));
  if (!after.includes("03-31-05-35-Q") || after.length !== before + 2) throw new Error("codes not in the list");

  // Use it in an entry right away.
  await p.goto(BASE + "/app/#"); await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '26', exact: true }).click();
  await p.locator('#worker').fill("INB-01"); await p.keyboard.press('Enter');
  await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
  await p.keyboard.press('Control+a'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.keyboard.type('03-31-05-35-Q'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.waitForSelector('.queue tbody tr');
  await p.waitForFunction(() => !document.querySelector('.queue tbody').innerText.includes("checking"), null, { timeout: 15000 });
  const row = await p.locator('.queue tbody tr').first().innerText();
  console.log("entry with the new code:", row.replace(/\s+/g, " ").slice(0, 90));
  if (/not in the activity list/i.test(row)) throw new Error("new code not accepted");
  await p.getByRole('button', { name: 'Remove all' }).click().catch(() => {});

  // Undo the batch: the codes leave the list again.
  await p.goto(BASE + "/app/#codes"); await p.waitForSelector("#new-codes");
  await p.locator('.batches li', { hasText: "L312" }).or(p.locator('.batches li').first()).getByRole('button', { name: 'Undo' }).click();
  await p.waitForFunction(async () => !(await (await fetch('/api/master?fresh=true')).json()).activities.includes("03-31-05-35-Q"), null, { timeout: 15000 });
  console.log("after undo: back to", (await p.evaluate(async () => (await (await fetch('/api/master')).json()).activities.length)), "codes; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
