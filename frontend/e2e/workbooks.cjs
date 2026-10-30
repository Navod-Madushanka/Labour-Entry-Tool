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
  await p.waitForSelector(".book-current");
  const switchTo = async (name) => {
    await p.locator(".book-current").click();
    await p.locator(".book-list .book-name", { hasText: name }).click();
  };
  if (!(await p.locator('input[aria-label="Activity 1"]').count())) throw new Error("A should have activity boxes");
  console.log("A: activity boxes shown");
  // Switch to B: not checked yet -> start page, activity checks found off
  await switchTo("DEMO B.json");
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
  await switchTo("DEMO A.json");
  await p.waitForSelector('input[aria-label="Activity 1"]');
  console.log("A again: activity boxes shown");

  // Place names: asked once on the start page, then shown next to the codes.
  await p.getByRole("button", { name: "Check workbook" }).click();
  await p.waitForSelector("text=Places in the activity codes");
  await p.getByLabel("Place for -P").fill("Parking area");
  await p.getByRole("button", { name: "Save place names" }).click();
  await p.waitForSelector("text=Places in the activity codes", { state: "detached" });
  await p.getByRole("button", { name: /^Continue/ }).click();
  await p.getByRole("button", { name: /Start entering data|Start anyway/ }).click();
  await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '4', exact: true }).click();
  for (const name of ["AAA-01", "AAA-02"]) {
    await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
    await p.keyboard.type('7'); await p.keyboard.press('Enter');
    await p.keyboard.type('19'); await p.keyboard.press('Enter');
    const hint = await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder");
    console.log(name, "suggested:", hint);
    await p.keyboard.press('Enter'); // takes the suggestion
    await p.waitForSelector("text=Parking area");
    await p.keyboard.press('Enter'); // empty second activity: adds the worker
    await p.waitForFunction((n) => [...document.querySelectorAll('.queue tbody tr')].some((r) => r.textContent.includes(n)), name);
  }
  await p.screenshot({ path: out + "/a-places.png", fullPage: true });
  const queued = await p.locator('.queue tbody').innerText();
  if ((queued.match(/03-11-00-00-P/g) || []).length < 2) throw new Error("suggested code not queued: " + queued);
  // Asked once: checking again does not ask again.
  await p.getByRole("button", { name: "Check workbook" }).click();
  await p.waitForSelector("text=Check activity codes and hours");
  await p.waitForTimeout(1500);
  if (await p.locator("text=Places in the activity codes").count()) throw new Error("place names asked twice");
  console.log("place names asked once; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
