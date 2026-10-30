// After adding a worker the form is empty, and the next worker's suggested times and code show in
// the empty boxes: Enter takes them. Also cleared after a push.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/suggest-fill.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '7', exact: true }).click();
  const values = () => p.evaluate(() => [document.querySelector("#in").value, document.querySelector("#out").value,
    document.querySelector('input[aria-label="Activity 1"]')?.value ?? null]);

  // First worker typed by hand, with times different from their history.
  await p.locator('#worker').fill("AAA-01"); await p.keyboard.press('Enter');
  await p.keyboard.type('8'); await p.keyboard.press('Enter');
  await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.waitForSelector('.queue tbody tr');
  const after = await values();
  if (after.join("|") !== "||") throw new Error("form not cleared after adding: " + after);
  console.log("form cleared after adding");

  // AAA-02 usually works with AAA-01: today's times and code are suggested; Enter, Enter, Enter, Enter.
  await p.locator('#worker').fill("AAA-02"); await p.keyboard.press('Enter');
  console.log("In suggests:", await p.locator("#in").getAttribute("placeholder"), "| Out:", await p.locator("#out").getAttribute("placeholder"));
  await p.keyboard.press('Enter'); // takes In and Out, goes to the activity
  await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Activity 1");
  console.log("Activity suggests:", await p.locator('input[aria-label="Activity 1"]').getAttribute("placeholder"));
  await p.keyboard.press('Enter'); // takes the code
  await p.waitForSelector('input[aria-label="Activity 2"]:focus');
  await p.keyboard.press('Enter'); // adds the worker
  await p.waitForFunction(() => document.querySelector('.queue tbody').innerText.includes("AAA-02"));
  const row = await p.locator('.queue tbody tr', { hasText: "AAA-02" }).innerText();
  console.log("AAA-02 queued:", row.replace(/\s+/g, " "));
  if (!/08:00.20:00/.test(row) || !row.includes("03-11-00-00-P")) throw new Error("suggestion not used");

  // A worker with no partner today: their usual times are suggested.
  await p.locator('#worker').fill("AAA-05"); await p.keyboard.press('Enter');
  console.log("AAA-05 In suggests:", await p.locator("#in").getAttribute("placeholder"), await p.locator("#in").getAttribute("title"));

  // Push: the form is left clean (no worker was being typed).
  await p.locator('#worker').fill("");
  await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled);
  await p.locator('.push-bar button').click();
  await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  const pushed = await values();
  if (pushed.join("|") !== "||") throw new Error("form not clear after push: " + pushed);
  console.log("form clear after push; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
