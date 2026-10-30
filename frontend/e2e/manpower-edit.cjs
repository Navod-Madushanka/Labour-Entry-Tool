// Change entries on the manpower sheet before pushing: times, hours, remove, back to the form.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/manpower-edit.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '6', exact: true }).click();
  for (const name of ["AAA-01", "AAA-02", "AAA-03"]) {
    await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
    await p.keyboard.type('7'); await p.keyboard.press('Enter');
    await p.keyboard.type('19'); await p.keyboard.press('Enter');
    await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.waitForFunction((n) => [...document.querySelectorAll('.queue tbody tr')].some((r) => r.textContent.includes(n)), name);
  }
  const queueText = () => p.locator('.queue tbody').innerText();

  // Out 19 -> 21 for AAA-02: worked hours 11 -> 13, and the activity hours follow.
  await p.getByRole("button", { name: "Change AAA-02 Time Out" }).click();
  await p.getByLabel("AAA-02 Time Out").fill("21"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => /AAA-02[\s\S]*21:00[\s\S]*03-11-00-00-P · 13/.test(document.querySelector('.queue tbody').innerText));
  console.log("AAA-02 out changed: hours follow");

  // Hours of AAA-03 to 10 (one hour to ZIDLE).
  await p.getByRole("button", { name: "Change AAA-03 hours on 03-11-00-00-P" }).click();
  await p.getByLabel("AAA-03 hours on 03-11-00-00-P").fill("10"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => /AAA-03[\s\S]*03-11-00-00-P · 10/.test(document.querySelector('.queue tbody').innerText));
  console.log("AAA-03 hours changed");

  // Esc leaves a cell as it was.
  await p.getByRole("button", { name: "Change AAA-03 Time In" }).click();
  await p.getByLabel("AAA-03 Time In").fill("9"); await p.keyboard.press("Escape");
  if (!(await queueText()).match(/AAA-03\s+07:00/)) throw new Error("Esc should cancel");

  // Remove AAA-01.
  await p.locator(".manpower").getByRole("button", { name: "Remove AAA-01" }).click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody').innerText.includes("AAA-01"));
  console.log("AAA-01 removed");
  await p.screenshot({ path: out + "/manpower-edit.png", fullPage: true });

  // Push and read back what Excel holds.
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled);
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const day = await p.evaluate(async () => (await (await fetch('/api/days/6')).json()).entries.map(v => [v.entry.calling_name, v.entry.time_in, v.entry.time_out, v.entry.activities.filter(a => a.code).map(a => a.hours)]));
  console.log("sheet 6 in Excel:", JSON.stringify(day));
  if (JSON.stringify(day) !== JSON.stringify([["AAA-02", 7, 21, [13]], ["AAA-03", 7, 19, [10]]])) throw new Error("unexpected write");

  // ✎ moves a worker back into the form.
  await p.locator('#worker').fill("AAA-04"); await p.keyboard.press('Enter');
  await p.keyboard.type('7'); await p.keyboard.press('Enter');
  await p.keyboard.type('19'); await p.keyboard.press('Enter');
  await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.locator(".manpower").getByRole("button", { name: "Edit AAA-04" }).click();
  await p.waitForFunction(() => document.querySelector('#worker').value === "AAA-04" && !document.querySelector('.queue tbody tr'));
  console.log("AAA-04 back in the form; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
