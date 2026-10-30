// "Already in Excel for this day" shows the latest pushed first; "Recent batches" scrolls at a
// fixed height.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/daylist-order.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  await p.getByRole('tab', { name: '2', exact: true }).click(); // has AAA-01..09 in Excel already
  const push = async (names) => {
    for (const name of names) {
      await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
      await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
      await p.waitForFunction((n) => document.querySelector('.queue tbody')?.innerText.includes(n), name);
    }
    await p.waitForFunction(() => !document.querySelector('.push-bar button')?.disabled, null, { timeout: 15000 });
    await p.locator('.push-bar button').click();
    await p.waitForFunction(() => !document.querySelector('.queue tbody tr'));
  };
  await push(["AAA-10", "AAA-11"]);
  await push(["AAA-12"]);
  for (const sheet of ["4", "5", "6", "7", "8", "9"]) { // more batches, on other days
    await p.getByRole('tab', { name: sheet, exact: true }).click();
    await push(["AAA-01"]);
  }
  await p.getByRole('tab', { name: '2', exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll('.daylist tbody tr').length >= 12);
  const order = await p.$$eval('.daylist tbody tr', (rs) => rs.map((r) => r.cells[0].innerText.split("\n")[0]));
  console.log("day list:", order.join(" "));
  if (order.slice(0, 3).join() !== "AAA-12,AAA-11,AAA-10") throw new Error("latest pushed should be first");
  if (order.slice(3, 6).join() !== "AAA-01,AAA-02,AAA-03") throw new Error("rows from Excel should follow in sheet order");
  console.log("first row:", (await p.locator('.daylist tbody tr').first().innerText()).replace(/\s+/g, " ").slice(0, 60));
  const box = await p.$eval('.batches-scroll', (el) => ({ max: getComputedStyle(el).maxHeight, h: el.clientHeight, full: el.scrollHeight, items: el.children.length }));
  console.log("batches list:", JSON.stringify(box));
  if (box.max !== "240px" || box.h > 240 || box.full <= box.h) throw new Error("batches list should keep its height and scroll");
  await p.locator('section.batches').screenshot({ path: out + "/batches.png" });
  console.log("errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
