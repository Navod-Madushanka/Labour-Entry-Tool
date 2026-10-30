// Discard a whole sheet's waiting entries from under the manpower sheet; other sheets stay.
//
//   cd backend && python ../scripts/demo_two_books.py      (fresh server, made-up data)
//   node e2e/discard-sheet.cjs [screenshot-dir]
const { chromium } = require("playwright");

const out = process.argv[2] || ".";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8012/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let answer = true; p.on('dialog', d => { console.log("asked:", d.message().split("\n")[0]); answer ? d.accept() : d.dismiss(); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.setItem("labour.user", "Tester")); await p.reload();
  await p.waitForSelector("#worker");
  const add = async (sheet, names) => {
    await p.getByRole('tab', { name: sheet, exact: true }).click();
    for (const name of names) {
      await p.locator('#worker').fill(name); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('7'); await p.keyboard.press('Enter');
      await p.keyboard.press('Control+a'); await p.keyboard.type('19'); await p.keyboard.press('Enter');
      await p.keyboard.type('03-11-00-00-P'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
      await p.waitForFunction(([s, n]) => [...document.querySelectorAll('.queue tbody tr')].some((r) => r.textContent.startsWith(s) && r.textContent.includes(n)), [sheet, name]);
    }
  };
  await add("8", ["AAA-01", "AAA-02"]);
  await add("9", ["AAA-03"]);
  const queued = () => p.$$eval('.queue tbody tr', (rs) => rs.map((r) => r.cells[0].textContent.trim() + " " + r.cells[1].textContent.trim()));
  console.log("queued:", await queued());
  await p.screenshot({ path: out + "/discard-before.png", fullPage: true });

  answer = false; // Cancel: nothing goes
  await p.getByRole("button", { name: "Discard sheet 8" }).click();
  if ((await queued()).length !== 3) throw new Error("cancel should keep the entries");

  answer = true;
  await p.getByRole("button", { name: "Discard sheet 8" }).click();
  await p.waitForFunction(() => document.querySelectorAll('.queue tbody tr').length === 1);
  const left = await queued();
  console.log("after discarding sheet 8:", left);
  if (left.join() !== "9 AAA-03") throw new Error("only sheet 9 should remain");
  if (await p.getByRole("button", { name: "Discard sheet 8" }).count()) throw new Error("sheet 8 still shown");
  const excel = await p.evaluate(async () => (await (await fetch('/api/days/8')).json()).entries.length);
  if (excel !== 0) throw new Error("Excel should not have changed");
  console.log("Excel sheet 8 untouched; errors:", errs);
  await b.close();
})().catch(e => { console.log("FAILED", e.message); process.exit(1); });
